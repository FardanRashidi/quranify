import { Listener } from './listener.js';
import { VersesView } from './verses-view.js';
import { SettingsPanel } from './settings-panel.js';
import { Follower } from './follow.js';
import { Reader, supported as canReadAloud } from './reader.js';
import * as settings from './settings.js';
import * as api from './api.js';

const FIRST_TRY_AFTER = 4; // seconds of audio to collect before the first attempt
const SEARCH_EVERY = 1; // checks run locally, so try again straight away
// Errors in a row double the wait, from the first to the second.
const RETRY_AFTER_ERROR = 10;
const MAX_RETRY_AFTER_ERROR = 60;
const MIN_AUDIBLE = 3; // seconds of actual sound a clip needs before it's worth sending
const LOST_AFTER = 12; // following: seconds without placing the reciter before the verses dim
const SPEEDS = [0.75, 1, 1.25, 1.5, 2]; // what the reading speed button steps through
const METER_BARS = 24;
const METER_CHARS = ' ▁▂▃▄▅▆▇█';
// The key above each surah, in Malay when the translation is Malay. Each waqf
// sign is written out in full-size letters (it's a miniature of them), since a
// sign on its own has nothing to sit on.
const TAJWEED_KEY = {
  en: {
    colours: { madd: 'long, 4–6 counts', qalqalah: 'qalqalah', ghunnah: 'nasal (ghunnah)', ra: 'heavy ra' },
    waqf: [
      ['م', 'must stop'],
      ['قلى', 'better to stop'],
      ['ج', 'may stop'],
      ['صلى', 'better to go on'],
      ['لا', "don't stop"],
      ['∴ ∴', 'stop at one of the two'],
      ['س', 'brief pause, no breath (saktah)'],
    ],
  },
  ms: {
    colours: { madd: 'mad 4–6 harakat', qalqalah: 'qalqalah', ghunnah: 'dengung', ra: 'ra’ tebal' },
    waqf: [
      ['م', 'mesti berhenti'],
      ['قلى', 'lebih baik berhenti'],
      ['ج', 'boleh berhenti'],
      ['صلى', 'lebih baik sambung'],
      ['لا', 'jangan berhenti'],
      ['∴ ∴', 'berhenti di salah satu'],
      ['س', 'berhenti seketika tanpa nafas (saktah)'],
    ],
  },
};

const $ = (id) => document.getElementById(id);
const els = {
  source: $('source'),
  follow: $('follow'),
  listen: $('listen'),
  meter: $('meter'),
  nowPlaying: $('now-playing'),
  glyph: $('glyph'),
  title: $('title'),
  subtitle: $('subtitle'),
  details: $('details'),
  elapsed: $('elapsed'),
  duration: $('duration'),
  barFill: $('bar-fill'),
  reader: $('reader'),
  read: $('read'),
  readSpeed: $('read-speed'),
  status: $('status'),
  ayah: $('ayah'),
  ayahDown: $('ayah-down'),
  ayahUp: $('ayah-up'),
  ayahSync: $('ayah-sync'),
  translation: $('translation'),
  tajweed: $('tajweed'),
  openSettings: $('open-settings'),
  themeColour: document.querySelector('meta[name="theme-color"]'),
};

const listener = new Listener();
const versesView = new VersesView($('verses'));
const settingsPanel = new SettingsPanel($('settings'));
const follower = new Follower();
const reader = new Reader();
// Only desktop browsers can capture another tab's audio; phones just have the microphone.
const canCaptureTab = Boolean(navigator.mediaDevices?.getDisplayMedia);
const darkScheme = matchMedia('(prefers-color-scheme: dark)');

const state = {
  status: 'idle', // idle | searching | following
  session: 0, // bumped whenever in-flight work should be thrown away
  surah: null, // the surah on screen ({ number } while it loads)
  ayah: null, // the highlighted ayah
  // listening
  source: 'mic', // what's being listened to: mic | tab
  following: false, // keep listening once the reciter is found, and move along with them
  searchFrom: null, // word index the reader was at when they asked to sync
  listenStartedAt: 0,
  heardAt: 0, // following: when a check last placed the reciter
  unsure: false, // the last match is a passage that's in more than one place
  quranReady: null, // promise: the server's speech model is loaded
  loadingModel: false,
  modelProgress: null, // { loaded, total } bytes, if the backend reports them
  errors: 0, // failed attempts in a row
  note: '', // why the last attempt didn't match
  busy: false,
  syncQueued: false,
  timer: null,
  nextAttemptAt: 0,
  // reading aloud
  reading: false, // reading the translation aloud, ayah after ayah
  readingAyah: null, // the ayah being read; null between ayahs (waiting for the reciter to reach the next)
  readSession: 0, // bumped whenever a read in progress should be dropped
  readEndedAt: -Infinity, // when the voice last went quiet, so checks can leave it out
  readError: '',
};

// --- listening loop ---------------------------------------------------------

/** @param {boolean} follow keep listening once the reciter is found, and move along with them */
async function start(follow = false) {
  els.listen.disabled = els.follow.disabled = true;
  state.source = canCaptureTab ? settings.get('source') : 'mic';
  try {
    await listener.start(state.source, settings.get('microphone'));
  } catch (err) {
    els.listen.disabled = els.follow.disabled = false;
    setStatus('idle');
    els.status.textContent = `couldn't start: ${describeStartError(err)}`;
    return;
  }
  listener.onEnded = stop;
  state.session++;
  state.following = follow;
  state.listenStartedAt = performance.now();
  state.note = '';
  state.errors = 0;
  follower.reset();
  els.listen.disabled = els.follow.disabled = false;
  els.source.disabled = true;
  renderListenButtons();
  if (state.surah) {
    // Keep the surah on screen, and prefer matches that continue from where the reader is.
    state.searchFrom = state.surah.verses?.[state.ayah - 1]?.firstWord ?? null;
  } else {
    reset();
    state.searchFrom = null;
  }
  setStatus('searching');
  schedule(FIRST_TRY_AFTER);
  requestAnimationFrame(frame);
}

function stop() {
  // Reading along with the reciter has nothing more to go on.
  if (state.following && state.reading) stopReading();
  listener.stop();
  state.session++;
  state.following = false;
  clearTimeout(state.timer);
  state.busy = false;
  els.source.disabled = false;
  els.meter.textContent = '';
  renderListenButtons();
  setStatus('idle');
}

/** Follow: listen, and keep up with the reciter until it's pressed again. */
function toggleFollow() {
  if (state.following) return stop();
  if (!listener.active) return start(true);
  // A Listen & sync under way carries on following once it's found the place.
  state.following = true;
  renderListenButtons();
}

/** The S key: check right now, from the audio already heard. */
function syncNow() {
  if (!listener.active) return start();
  if (state.busy) {
    state.syncQueued = true;
    return;
  }
  clearTimeout(state.timer);
  attempt();
}

function schedule(seconds) {
  clearTimeout(state.timer);
  state.nextAttemptAt = performance.now() + seconds * 1000;
  state.timer = setTimeout(attempt, seconds * 1000);
}

async function attempt() {
  const session = state.session;
  if (!listener.active || state.busy) return;
  if (listener.bufferedSeconds < 1) return schedule(SEARCH_EVERY);
  // The microphone hears the translation being read aloud through the speaker:
  // wait for it to finish, then send only what came after.
  let seconds = settings.get('clipSeconds');
  if (micHearsReading()) {
    if (state.readingAyah !== null) return schedule(SEARCH_EVERY);
    const since = (performance.now() - state.readEndedAt) / 1000;
    if (since < FIRST_TRY_AFTER) return schedule(FIRST_TRY_AFTER - since);
    seconds = Math.min(seconds, since);
  }

  state.busy = true;
  try {
    const clip = await listener.clip(seconds);
    if (session !== state.session) return;
    if (clip.audible < MIN_AUDIBLE) return miss('too quiet');
    await warmUpQuran();
    if (session !== state.session) return;
    const match = await api.recognizeQuran(clip.pcm, follower.word ?? state.searchFrom);
    if (session !== state.session) return;
    state.errors = 0;
    if (match) onVerse(match, clip.endedAt);
    else miss('no verse matched yet');
  } catch (err) {
    if (session !== state.session) return;
    console.error(err);
    state.note = `error: ${err.message}`;
    state.errors++;
    schedule(Math.min(RETRY_AFTER_ERROR * 2 ** (state.errors - 1), MAX_RETRY_AFTER_ERROR));
  } finally {
    if (session === state.session) {
      state.busy = false;
      if (state.syncQueued) {
        state.syncQueued = false;
        syncNow();
      }
    }
  }
}

function onVerse(match, endedAt) {
  const wasFound = follower.found;
  const target = follower.take(match, endedAt);
  state.note = '';
  if (!target) return schedule(nextDelay()); // following, and a phrase from elsewhere that could be either: stay put
  // A passage that's in more than one place: show the best guess dimmed and keep
  // listening until the reciter says something that settles it (or we run out of patience).
  state.unsure = target.unsure && performance.now() - state.listenStartedAt < settings.get('giveUpAfter') * 1000;
  if (!target.unsure) state.heardAt = performance.now();
  const moved = target.surah !== state.surah?.number || target.ayah !== state.ayah;
  if (state.surah?.number === target.surah) setAyah(target.ayah, state.following && wasFound ? 'follow' : true);
  else showSurah(target.surah, target.ayah);
  // Reading along: start on this ayah if the last one's done (otherwise it carries on here when it is).
  if (moved && state.reading && (!state.following || state.readingAyah === null)) readAloud();

  if (state.unsure) {
    setStatus('searching');
    return schedule(SEARCH_EVERY);
  }
  if (!state.following || !follower.found) return stop(); // found it: no need to keep the microphone on
  setStatus('following');
  schedule(nextDelay());
}

function miss(reason) {
  state.note = reason;
  // Give up after a while without finding the reciter (or, following, without hearing them).
  if (performance.now() - listeningSince() > settings.get('giveUpAfter') * 1000) {
    state.note = follower.found ? 'lost the reciter' : "couldn't place the recitation";
    return stop();
  }
  schedule(nextDelay());
}

function nextDelay() {
  if (!state.following || !follower.found) return SEARCH_EVERY;
  const { surah, ayah } = follower.at;
  const verse = state.surah?.number === surah ? state.surah.verses?.[ayah - 1] : undefined;
  return follower.delay(performance.now(), verse, { min: settings.get('followMin'), max: settings.get('followMax') });
}

/** Following, but nothing has placed the reciter for a while. */
function lost() {
  if (!state.following || !follower.found || (micHearsReading() && state.readingAyah !== null)) return false;
  return performance.now() - listeningSince() > LOST_AFTER * 1000;
}

// When it last heard the reciter (or started listening), not counting time spent
// reading aloud through the speaker, when it can't listen.
function listeningSince() {
  const since = follower.found ? state.heardAt : state.listenStartedAt;
  return micHearsReading() ? Math.max(since, state.readEndedAt) : since;
}

function micHearsReading() {
  return state.source === 'mic' && !settings.get('listenWhileReading');
}

function warmUpQuran() {
  if (!state.quranReady) {
    state.loadingModel = true;
    state.modelProgress = null;
    state.quranReady = api
      .warmUpQuran((progress) => {
        state.modelProgress = progress;
        if (state.status === 'idle') els.status.textContent = idleStatusText();
      })
      .finally(() => {
        state.loadingModel = false;
        if (state.status === 'idle') els.status.textContent = idleStatusText();
      })
      .catch((err) => {
        state.quranReady = null;
        throw err;
      });
  }
  return state.quranReady;
}

// --- reading aloud ----------------------------------------------------------

function toggleReading() {
  if (state.reading) return stopReading();
  if (!state.surah?.verses || settings.get('translation') === 'none') return;
  state.reading = true;
  state.readError = '';
  readAloud();
}

/**
 * (Re)starts reading from the ayah on screen. On its own it carries on to the end
 * of the surah; following, it reads each ayah as the reciter reaches it.
 */
async function readAloud() {
  const session = pauseReading();
  while (state.reading && session === state.readSession) {
    const verses = state.surah?.verses;
    if (!verses) return renderReading(); // still loading: showSurah starts again
    const verse = verses[state.ayah - 1];
    if (!verse?.translation) return stopReading();
    state.readingAyah = state.ayah;
    versesView.setReading(state.ayah - 1);
    renderReading();
    let finished;
    try {
      finished = await reader.read(verse.translation, settings.get('translation'), (start, end) => versesView.markWord(start, end));
    } catch (err) {
      console.error(err);
      if (session === state.readSession) stopReading(`couldn't read aloud: ${err.message}`);
      return;
    }
    if (session !== state.readSession) return;
    state.readEndedAt = performance.now();
    if (!finished) return stopReading();
    if (state.following) {
      if (state.ayah !== state.readingAyah) continue; // the reciter moved on while this was read
      pauseReading(); // until the reciter reaches the next one (onVerse starts again)
      return renderReading();
    }
    if (state.ayah >= verses.length) return stopReading(); // the end of the surah
    setAyah(state.ayah + 1, 'follow');
  }
}

/** Drops whatever's being read, but stays in reading mode. Returns the new read session. */
function pauseReading() {
  reader.stop();
  if (state.readingAyah !== null) state.readEndedAt = performance.now();
  state.readingAyah = null;
  versesView.setReading(-1);
  return ++state.readSession;
}

function stopReading(error = '') {
  pauseReading();
  state.reading = false;
  state.readError = error;
  renderReading();
}

function nextSpeed() {
  const speed = settings.get('readingSpeed');
  settings.set('readingSpeed', SPEEDS.find((s) => s > speed + 0.01) ?? SPEEDS[0]);
}

function renderReading() {
  els.reader.hidden = !canReadAloud || settings.get('translation') === 'none';
  els.read.setAttribute('aria-pressed', String(state.reading));
  els.read.classList.toggle('speaking', state.readingAyah !== null);
  els.readSpeed.textContent = `${settings.get('readingSpeed')}×`;
  if (state.status === 'idle') els.status.textContent = idleStatusText();
  updateWakeLock();
}

// Keep the screen on while listening or reading aloud: nobody's touching it then.
function updateWakeLock() {
  api.keepScreenOn(listener.active || state.reading);
}

// --- rendering --------------------------------------------------------------

/** Back to a blank slate: nothing found. */
function reset() {
  Object.assign(state, { surah: null, ayah: null, unsure: false });
  els.nowPlaying.hidden = true;
  document.title = 'quran-finder';
  versesView.message(listener.active ? 'listening for the recitation…' : 'press Listen & sync and play a recitation');
  renderAyah();
}

async function showSurah(number, ayah) {
  const placeholder = { number };
  state.surah = placeholder; // so further matches in this surah don't refetch it
  state.ayah = ayah;
  if (state.reading) pauseReading(); // its verse is going; it starts again once the surah's loaded
  els.nowPlaying.hidden = false;
  els.glyph.textContent = String(number);
  els.title.textContent = `Surah ${number}`;
  els.subtitle.textContent = els.details.textContent = '';
  versesView.message('loading verses…');
  try {
    const surah = await api.fetchSurah(number, settings.get('translation'));
    if (state.surah !== placeholder) return;
    state.surah = surah;
    els.title.textContent = `Surah ${surah.englishName}`;
    els.subtitle.textContent = `${surah.englishNameTranslation} · ${surah.name}`;
    els.details.textContent = `${surah.revelationType} · ${surah.verses.length} verses`;
    els.duration.textContent = String(surah.verses.length);
    document.title = `${surah.englishName} — quran-finder`;
    versesView.showVerses(surah, tajweedKey());
    renderTajweed();
    setAyah(state.ayah, true); // the latest match may have arrived while loading
    if (state.reading) readAloud();
  } catch (err) {
    if (state.surah === placeholder) versesView.message(`couldn't load the surah: ${err.message}`);
  }
}

function tajweedKey() {
  const { colours, waqf } = TAJWEED_KEY[settings.get('translation')] ?? TAJWEED_KEY.en;
  const key = document.createElement('div');
  key.className = 'tajweed-key';
  const row = (items) => {
    const p = document.createElement('p');
    for (const [className, mark, label, colour] of items) {
      const item = document.createElement('span');
      if (colour) item.dataset.colour = colour; // hidden while that colour is turned off
      item.append(Object.assign(document.createElement('span'), { className, textContent: mark }), ` ${label}`);
      p.append(item);
    }
    return p;
  };
  key.append(
    row(Object.entries(colours).map(([colour, label]) => [`tj-${colour}`, '●', label, colour])),
    row(waqf.map(([sign, label]) => ['tj-waqf sign', sign, label])),
  );
  return key;
}

function renderTajweed() {
  const on = settings.get('tajweed');
  document.body.classList.toggle('tajweed', on);
  document.body.classList.toggle('no-tajweed-key', !settings.get('tajweedKey'));
  els.tajweed.setAttribute('aria-pressed', String(on));
  for (const item of document.querySelectorAll('.tajweed-key [data-colour]')) {
    item.hidden = settings.get(`tj-${item.dataset.colour}`) === 'off';
  }
}

/** @param {'follow' | boolean} scroll see VersesView.setCurrent */
function setAyah(ayah, scroll = true) {
  state.ayah = ayah;
  const verses = state.surah?.verses;
  if (!verses) return; // applied once the surah has loaded
  state.ayah = Math.min(Math.max(ayah, 1), verses.length);
  versesView.setCurrent(state.ayah - 1, scroll);
  els.elapsed.textContent = `ayah ${state.ayah}`;
  els.barFill.style.width = `${(state.ayah / verses.length) * 100}%`;
  renderAyah();
  if (state.status === 'idle') els.status.textContent = idleStatusText();
}

// The reader moving through the verses themselves: − +, the arrow keys, or a tap.
function goTo(ayah, scroll) {
  setAyah(ayah, scroll);
  if (state.reading) readAloud(); // read from here instead
}

function step(direction) {
  if (state.surah?.verses && state.ayah) goTo(state.ayah + direction, true);
}

function frame() {
  if (!listener.active) return;
  requestAnimationFrame(frame);

  if (settings.get('meter')) {
    els.meter.textContent = listener
      .levels(METER_BARS)
      .map((level) => METER_CHARS[Math.round(level * (METER_CHARS.length - 1))])
      .join('');
  }
  renderStale();
  setText(els.status, statusText());
}

function statusText() {
  if (state.loadingModel) return modelLoadingText();
  if (state.unsure) return 'this passage appears in more than one place · listening a bit more…';
  if (state.following && follower.found) {
    const place = state.surah?.verses ? ` ${state.surah.englishName} ${state.surah.number}:${state.ayah}` : '';
    if (micHearsReading() && state.readingAyah !== null) return `following${place} · listening again once it’s read aloud`;
    if (lost()) return `following${place} · can't hear the reciter${state.note ? ` (${state.note})` : ''} · listening…`;
    if (state.busy) return `following${place} · checking…`;
    const wait = Math.max(0, Math.ceil((state.nextAttemptAt - performance.now()) / 1000));
    return `following${place} · next check in ${wait}s`;
  }
  return `listening for the recitation…${state.note ? ` · ${state.note}` : ''}`;
}

function modelLoadingText() {
  const { loaded, total } = state.modelProgress ?? {};
  if (!total) return 'loading the Quran speech model… (the first time downloads ~400 MB)';
  const mb = (bytes) => Math.round(bytes / 1e6);
  return `loading the Quran speech model… ${Math.floor((loaded / total) * 100)}% (${mb(loaded)} of ${mb(total)} MB)`;
}

function idleStatusText() {
  if (state.surah?.verses && state.ayah) {
    const place = `${state.surah.englishName} ${state.surah.number}:${state.ayah}`;
    if (state.readError) return `${place} · ${state.readError}`;
    if (state.reading) return `${place} · reading the translation aloud`;
    return `${place} · − + to move · sync if you lose your place`;
  }
  if (state.note) return `${state.note} · press Listen & sync to try again`;
  if (state.loadingModel && state.modelProgress) return modelLoadingText();
  return state.surah ? 'stopped · press Listen & sync to start again' : 'idle · press Listen & sync (space), or Follow (F)';
}

function setStatus(status) {
  state.status = status;
  document.body.dataset.status = status;
  renderStale();
  if (status === 'idle') els.status.textContent = idleStatusText();
}

// Dim the verses whenever the highlight might not be in the right place. (Verses
// don't move by themselves, so a found surah stays bright after listening stops.)
function renderStale() {
  document.body.classList.toggle('stale', Boolean(state.surah) && (state.unsure || lost()));
}

function renderListenButtons() {
  els.listen.textContent = listener.active ? 'Stop' : 'Listen & sync';
  els.ayahSync.textContent = listener.active ? 'stop' : 'sync';
  els.follow.setAttribute('aria-pressed', String(state.following));
  updateWakeLock();
}

function renderAyah() {
  els.ayah.textContent = state.surah?.verses && state.ayah ? `${state.ayah} / ${state.surah.verses.length}` : '–';
}

// The accent is the user's own colour, or the theme's.
function applyAccent() {
  const root = document.documentElement.style;
  const accent = settings.get('accent');
  if (accent) {
    root.setProperty('--accent', accent);
    root.setProperty('--on-accent', relativeLuminance(accent) > 0.4 ? '#0b0e12' : '#ffffff');
  } else {
    root.removeProperty('--accent');
    root.removeProperty('--on-accent');
  }
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// WCAG's relative luminance: 0 for black, 1 for white.
function relativeLuminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function applyTheme() {
  const theme = settings.get('theme');
  const dark = theme === 'auto' ? darkScheme.matches : theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  els.themeColour.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  api.styleSystemBars(dark);
  settingsPanel.refresh(); // colours shown as "the theme's own" changed
}

const SCALES = { arabicSize: '--arabic-scale', translationSize: '--translation-scale' };

/** Puts a setting into effect, whether it changed in the settings panel or elsewhere. */
function applySetting(key) {
  const value = settings.get(key);
  const root = document.documentElement.style;
  if (key in SCALES) return root.setProperty(SCALES[key], value / 100);
  if (key.startsWith('tj-')) {
    if (value) root.setProperty(`--${key}`, value === 'off' ? 'currentColor' : value);
    else root.removeProperty(`--${key}`);
    return renderTajweed();
  }
  switch (key) {
    case 'theme':
      return applyTheme();
    case 'accent':
      return applyAccent();
    case 'meter':
      els.meter.hidden = !value;
      return;
    case 'animations':
      document.body.classList.toggle('still', !value);
      versesView.smooth = value;
      return;
    case 'followScroll':
      versesView.follow = value;
      return;
    case 'translation':
      els.translation.value = value;
      if (value === 'none' && state.reading) stopReading();
      renderReading();
      if (state.surah) showSurah(state.surah.number, state.ayah);
      return;
    case 'tajweed':
    case 'tajweedKey':
      return renderTajweed();
    case 'source':
      els.source.value = value;
      return;
    case 'readingSpeed':
    case 'voiceEn':
    case 'voiceMs':
      renderReading();
      if (key === 'readingSpeed' || key === (settings.get('translation') === 'ms' ? 'voiceMs' : 'voiceEn')) reader.again();
      return;
  }
}

function describeStartError(err) {
  if (err.name === 'NotAllowedError') return 'permission denied';
  if (err.name === 'NotFoundError') return 'no microphone found';
  return err.message;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// --- wiring -----------------------------------------------------------------

els.listen.addEventListener('click', () => (listener.active ? stop() : start()));
els.follow.addEventListener('click', toggleFollow);
// Listen & sync again, down by the ayah buttons where a thumb can reach it
els.ayahSync.addEventListener('click', () => els.listen.click());
els.source.addEventListener('change', () => settings.set('source', els.source.value));
els.translation.addEventListener('change', () => settings.set('translation', els.translation.value));
els.tajweed.addEventListener('click', () => settings.set('tajweed', !settings.get('tajweed')));
els.read.addEventListener('click', toggleReading);
els.readSpeed.addEventListener('click', nextSpeed);
els.openSettings.addEventListener('click', () => settingsPanel.show());
settings.onChange(applySetting);
darkScheme.addEventListener('change', () => settings.get('theme') === 'auto' && applyTheme());
els.ayahDown.addEventListener('click', () => step(-1));
els.ayahUp.addEventListener('click', () => step(1));
// Tapping a verse makes it the current one.
versesView.onSelect = (index) => {
  if (state.surah?.verses) goTo(index + 1, false);
};
// The app opened from one of auto search's notifications: show what it heard.
api.onOpenAyah(({ surah, ayah }) => {
  if (listener.active) stop();
  if (state.surah?.number === surah && state.surah.verses) goTo(ayah, true);
  else showSurah(surah, ayah);
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || settingsPanel.open || e.target.closest('select, input')) return;
  if (e.key === ' ' && !e.target.closest('button')) {
    e.preventDefault();
    els.listen.click();
  } else if (e.key === 'r' || e.key === 's') {
    syncNow();
  } else if (e.key === 'f') {
    toggleFollow();
  } else if (e.key === 't') {
    toggleReading();
  } else if (e.key === ']' || e.key === 'ArrowRight') {
    step(1);
  } else if (e.key === '[' || e.key === 'ArrowLeft') {
    step(-1);
  }
});

if (!canCaptureTab) {
  els.source.querySelector('[value="tab"]').remove();
  els.source.hidden = true;
}
els.translation.value = settings.get('translation');
if (!els.translation.value) settings.set('translation', 'en'); // a translation we no longer offer
for (const key of Object.keys(settings.DEFAULTS)) applySetting(key);
renderListenButtons();
reset();
setStatus('idle');
warmUpQuran().catch(() => {}); // start loading the model now
