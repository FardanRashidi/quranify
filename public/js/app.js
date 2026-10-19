import { Listener } from './listener.js';
import { VersesView } from './verses-view.js';
import { SettingsPanel } from './settings-panel.js';
import { SurahPicker } from './surah-picker.js';
import { Tutorial } from './tutorial.js';
import { Follower } from './follow.js';
import { Reader, supportedFor, refreshVoices } from './reader.js';
import { translation } from './translations.js';
import * as settings from './settings.js';
import * as api from './api.js';

const FIRST_TRY_AFTER = 4; // seconds of audio to collect before the first attempt
// Looking in one surah, fewer words are enough to place the reciter, so it tries
// sooner. In testing it found them within 7 s 66% of the time, against 55% for
// the whole Quran with the first try at 4 s.
const FIRST_TRY_IN_SURAH = 2.5;
const SEARCH_EVERY = 1; // checks run locally, so try again straight away
// Errors in a row double the wait, from the first to the second.
const RETRY_AFTER_ERROR = 10;
const MAX_RETRY_AFTER_ERROR = 60;
const MIN_AUDIBLE = 3; // seconds of actual sound a clip needs before it's worth sending
const MIN_AUDIBLE_IN_SURAH = 2;
const LOST_AFTER = 12; // following: seconds without placing the reciter before the verses dim
const SPEEDS = [0.75, 1, 1.25, 1.5, 2]; // what the reading speed button steps through
// Reading every ayah while following: this much faster for each ayah the
// reciter is ahead, up to the most. Further behind than that, it skips to them.
const CATCH_UP = 0.1;
const MAX_CATCH_UP = 1.5;
const MAX_BEHIND = 10;
const NAME = 'Quran Whisperer';
const METER_BARS = 12;
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
  listen: $('listen'),
  meter: $('meter'),
  listenLabel: document.querySelector('#listen .label'),
  nowPlaying: $('now-playing'),
  glyph: $('glyph'),
  title: $('title'),
  subtitle: $('subtitle'),
  details: $('details'),
  barFill: $('bar-fill'),
  reader: $('reader'),
  read: $('read'),
  readLabel: document.querySelector('#read .label'),
  readSpeed: $('read-speed'),
  status: $('status'),
  ayahControls: $('ayah-controls'),
  ayah: $('ayah'),
  ayahDown: $('ayah-down'),
  ayahUp: $('ayah-up'),
  openSettings: $('open-settings'),
  openSurahs: $('open-surahs'),
  scope: $('scope'),
  themeColour: document.querySelector('meta[name="theme-color"]'),
};

const listener = new Listener();
const versesView = new VersesView($('verses'));
const settingsPanel = new SettingsPanel($('settings'));
const surahPicker = new SurahPicker($('surahs'));
const tutorial = new Tutorial($('tutorial'));
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
  placed: false, // the highlighted ayah is where the reader is (found, or moved to), not just the start of a surah they opened
  scope: null, // the surah Listen looks in, when it's to look in just one ("this surah only")
  // listening
  source: 'mic', // what's being listened to: mic | tab
  following: false, // keep listening once the reciter is found, and move along with them
  readOnFind: false, // start reading aloud once it's sure where the reciter is (Listen's "read aloud" setting)
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
  // reading aloud
  reading: false, // reading the translation aloud, ayah after ayah
  readingAyah: null, // the ayah being read; null between ayahs (waiting for the reciter to reach the next)
  lastRead: null, // following: the last ayah read to the end in this surah, so the next can follow it; null after a jump
  readSession: 0, // bumped whenever a read in progress should be dropped
  readEndedAt: -Infinity, // when the voice last went quiet, so checks can leave it out
  readError: '',
};

// --- listening loop ---------------------------------------------------------

/**
 * Listen: finds the ayah, then does what the settings' "listen button" section
 * says: follows the reciter, reads the translation aloud, both (the default) or neither.
 * @param {boolean} follow keep listening once the reciter is found, and move along with them
 */
async function start(follow = settings.get('listenFollow')) {
  els.listen.disabled = true;
  state.source = canCaptureTab ? settings.get('source') : 'mic';
  try {
    await listener.start(state.source, settings.get('microphone'));
  } catch (err) {
    els.listen.disabled = false;
    setStatus('idle');
    els.status.textContent = `Couldn’t start: ${describeStartError(err)}`;
    return;
  }
  listener.onEnded = stop;
  state.session++;
  state.following = follow;
  state.lastRead = null;
  state.readOnFind = settings.get('listenRead') && !state.reading;
  state.listenStartedAt = performance.now();
  state.note = '';
  state.errors = 0;
  follower.reset();
  els.listen.disabled = false;
  els.source.disabled = true;
  renderListenButtons();
  if (state.surah) {
    // Keep the surah on screen, and prefer matches that continue from where the reader is.
    state.searchFrom = state.placed ? (state.surah.verses?.[state.ayah - 1]?.firstWord ?? null) : null;
  } else {
    reset();
    state.searchFrom = null;
  }
  setStatus('searching');
  schedule(state.scope ? FIRST_TRY_IN_SURAH : FIRST_TRY_AFTER);
  requestAnimationFrame(frame);
}

function stop() {
  // Reading along with the reciter has nothing more to go on.
  if (state.following && state.reading) stopReading();
  listener.stop();
  state.session++;
  state.following = false;
  state.readOnFind = false;
  clearTimeout(state.timer);
  state.busy = false;
  els.source.disabled = false;
  els.meter.textContent = '';
  renderListenButtons();
  setStatus('idle');
}

/** The F key: listen and follow, whatever Listen is set to do; pressed again, stop. */
function toggleFollow() {
  if (state.following) return stop();
  if (!listener.active) return start(true);
  // Listening that would stop once it's found the place carries on following instead.
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
    if (clip.audible < (state.scope ? MIN_AUDIBLE_IN_SURAH : MIN_AUDIBLE)) return miss('Too quiet');
    await warmUpQuran();
    if (session !== state.session) return;
    const match = await api.recognizeQuran(clip.pcm, follower.word ?? state.searchFrom, state.scope);
    if (session !== state.session) return;
    state.errors = 0;
    if (match) onVerse(match, clip.endedAt);
    else miss('No ayah matched yet');
  } catch (err) {
    if (session !== state.session) return;
    console.error(err);
    state.note = `Error: ${err.message}`;
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
  state.placed = true;
  const moved = target.surah !== state.surah?.number || target.ayah !== state.ayah;
  // The reciter went somewhere that doesn't carry on from where they were: another
  // surah, or another part of this one (a repeat of the last few words still carries on).
  const jumped = wasFound && (target.surah !== state.surah?.number || !match.continues);
  if (state.surah?.number === target.surah) {
    if (jumped) state.lastRead = null;
    // Reading that's behind the reciter keeps the verse being read in view instead.
    setAyah(target.ayah, !(state.following && wasFound) ? true : readingLeads() ? false : 'follow');
  } else showSurah(target.surah, target.ayah);
  const startsReading = state.readOnFind && !state.unsure && !state.reading;
  if (!state.unsure) state.readOnFind = false;
  if (startsReading) startReading();
  else if (moved && state.reading) {
    if (!state.following || jumped) readAloud(); // from here (another surah: once it's loaded)
    else if (state.readingAyah === null) {
      // Done with the last one: on to the next, if the reciter has got to it.
      const next = nextToRead();
      if (next !== null) readAloud(next);
    } else reader.boost = catchUp(); // still reading one: a little faster, if they've got ahead
  }

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
    state.note = follower.found ? 'Lost the reciter' : 'Couldn’t find the ayah';
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
  if (state.surah?.verses) startReading();
}

function startReading() {
  if (!canRead()) return;
  state.reading = true;
  state.readError = '';
  state.lastRead = null;
  readAloud();
}

/**
 * (Re)starts reading, from the ayah on screen unless told otherwise. On its own it
 * carries on to the end of the surah. Following, it reads each ayah once the
 * reciter has reached it: every one in turn, or (with read every ayah off) the
 * one they're on, skipping any they've passed.
 */
async function readAloud(from = state.ayah) {
  const session = pauseReading();
  let ayah = from;
  while (state.reading && session === state.readSession) {
    const verses = state.surah?.verses;
    if (!verses) return renderReading(); // still loading: showSurah starts again
    const verse = verses[ayah - 1];
    if (!verse?.translation) return stopReading();
    state.readingAyah = ayah;
    versesView.setReading(ayah - 1, readingLeads() ? 'follow' : false);
    reader.boost = catchUp();
    renderReading();
    let finished;
    try {
      finished = await reader.read(verse.translation, settings.get('translation'), (start, end) => versesView.markWord(start, end), {
        surah: state.surah.number,
        ayah,
      });
    } catch (err) {
      console.error(err);
      if (session === state.readSession) stopReading(`Couldn’t read aloud: ${err.message}`);
      return;
    }
    if (session !== state.readSession) return;
    state.readEndedAt = performance.now();
    if (!finished) return stopReading();
    if (state.following) {
      state.lastRead = ayah;
      const next = nextToRead();
      if (next === null) {
        pauseReading(); // until the reciter reaches the next one (onVerse starts again)
        return renderReading();
      }
      ayah = next;
      continue;
    }
    if (ayah >= verses.length) return stopReading(); // the end of the surah
    setAyah(ayah + 1, 'follow');
    ayah = state.ayah;
  }
}

/** Following: the ayah to read next, or null to wait for the reciter to get to it. */
function nextToRead() {
  const last = state.lastRead;
  if (last === null || !settings.get('readEveryAyah')) return state.ayah !== last ? state.ayah : null;
  // Behind the last one read: a repeat (a jump back would have cleared `last`), so wait for them to come past it.
  if (state.ayah <= last) return null;
  if (state.ayah - last > MAX_BEHIND) return state.ayah; // too far behind to catch up: join them
  return last + 1;
}

/** How many ayahs the reading is behind the reciter (0 when it isn't reading). */
function readingBehind() {
  return state.reading && state.following && state.readingAyah !== null ? Math.max(0, state.ayah - state.readingAyah) : 0;
}

// Reading faster to catch up with the reciter: 10% for each ayah behind, up to 1.5×.
function catchUp() {
  return settings.get('readEveryAyah') ? Math.min(1 + CATCH_UP * readingBehind(), MAX_CATCH_UP) : 1;
}

// Reading every ayah while following: the verse being read, which can be behind
// the reciter's, is the one kept in view.
function readingLeads() {
  return state.following && state.reading && settings.get('readEveryAyah');
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

// The translation can be read aloud: there is one, and a voice (or the recording) for it.
function canRead() {
  const translation = settings.get('translation');
  return translation !== 'none' && supportedFor(translation);
}

function renderReading() {
  els.reader.hidden = !state.surah || !canRead();
  els.read.classList.toggle('on', state.reading);
  els.readLabel.textContent = state.reading ? 'Stop reading' : 'Read aloud';
  els.read.classList.toggle('speaking', state.readingAyah !== null);
  els.readSpeed.textContent = `Speed ${settings.get('readingSpeed')}×`;
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
  Object.assign(state, { surah: null, ayah: null, unsure: false, placed: false, scope: null });
  els.nowPlaying.hidden = true;
  document.title = NAME;
  versesView.message(listener.active ? 'Listening for the recitation…' : 'Press Listen and play a recitation, or choose a surah to read');
  renderAyah();
  renderReading();
  renderScope();
}

/** A surah chosen from the list: open it (at the start, or where auto search heard it), to read, and to listen in. */
function pickSurah(number, ayah = 1) {
  if (listener.active) stop();
  if (state.reading) stopReading();
  state.scope = number;
  state.placed = false;
  state.note = ''; // about the last listen, not this surah
  if (state.surah?.number === number && state.surah.verses) setAyah(ayah, true);
  else showSurah(number, ayah);
  renderScope();
}

// "this surah only": whether Listen looks in the surah on screen, or the whole Quran.
function renderScope() {
  els.scope.hidden = !state.surah;
  els.scope.setAttribute('aria-pressed', String(Boolean(state.surah) && state.scope === state.surah.number));
  renderListenButtons();
}

async function showSurah(number, ayah) {
  const placeholder = { number };
  state.surah = placeholder; // so further matches in this surah don't refetch it
  state.ayah = ayah;
  state.lastRead = null; // reading starts again where the reciter is
  if (state.scope !== number) state.scope = null; // that was about another surah
  renderScope();
  renderReading();
  if (state.reading) pauseReading(); // its verse is going; it starts again once the surah's loaded
  els.nowPlaying.hidden = false;
  els.glyph.textContent = String(number);
  els.title.textContent = `Surah ${number}`;
  els.subtitle.textContent = els.details.textContent = '';
  renderAyah();
  versesView.message('Loading the surah…', [els.nowPlaying]);
  try {
    const translation = settings.get('translation');
    const surah = await api.fetchSurah(number, translation);
    if (state.surah !== placeholder) return;
    state.surah = surah;
    els.title.textContent = `Surah ${surah.englishName}`;
    els.subtitle.textContent = `${surah.englishNameTranslation} · ${surah.name}`;
    els.details.textContent = `${surah.revelationType} · ${surah.verses.length} ayahs`;
    // Offline the first time a translation is chosen: the verses come without it.
    if (surah.translationError) els.details.textContent += ' · couldn’t download the translation (offline?)';
    document.title = `${surah.englishName} — ${NAME}`;
    versesView.showVerses(surah, [els.nowPlaying, tajweedKey()], translation);
    renderTajweed();
    setAyah(state.ayah, true); // the latest match may have arrived while loading
    if (state.reading) readAloud();
  } catch (err) {
    if (state.surah === placeholder) versesView.message(`Couldn’t load the surah: ${err.message}`);
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
  els.barFill.style.width = `${(state.ayah / verses.length) * 100}%`;
  renderAyah();
  if (state.status === 'idle') els.status.textContent = idleStatusText();
}

// The reader moving through the verses themselves: − +, the arrow keys, or a tap.
function goTo(ayah, scroll) {
  setAyah(ayah, scroll);
  state.placed = true;
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
  if (state.unsure) return 'This passage is in more than one place. Listening a bit more…';
  if (state.following && follower.found) {
    const place = state.surah?.verses ? `: ${state.surah.englishName}, ayah ${state.ayah}` : '';
    if (lost()) return `Following${place} · Can’t hear the reciter`;
    const behind = readingBehind();
    return `Following${place}${behind ? ` · Reading ayah ${state.readingAyah} (${behind} behind)` : ''}`;
  }
  const where = state.scope && state.surah?.englishName ? ` in ${state.surah.englishName}` : '';
  return `Listening for the recitation${where}…${state.note ? ` · ${state.note}` : ''}`;
}

function modelLoadingText() {
  const { loaded, total } = state.modelProgress ?? {};
  if (!total) return 'Loading the Quran speech model… (the first time downloads ~400 MB)';
  const mb = (bytes) => Math.round(bytes / 1e6);
  return `Loading the Quran speech model… ${Math.floor((loaded / total) * 100)}% (${mb(loaded)} of ${mb(total)} MB)`;
}

function idleStatusText() {
  const place = state.surah?.verses && state.ayah ? `${state.surah.englishName}, ayah ${state.ayah}` : '';
  if (place && state.readError) return `${place} · ${state.readError}`;
  if (place && state.reading) return `${place} · Reading aloud`;
  if (state.note) return `${state.note}. Press Listen to try again`;
  if (place) return place;
  if (state.loadingModel && state.modelProgress) return modelLoadingText();
  return state.surah ? 'Stopped. Press Listen to start again' : 'Ready. Press Listen and play a recitation';
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
  els.listenLabel.textContent = listener.active ? 'Stop' : 'Listen';
  els.listen.classList.toggle('listening', listener.active);
  const does = listenDoes() + (state.scope ? ' (in this surah only)' : '');
  els.listen.title = `Listen and ${does}  ( space )`;
  updateWakeLock();
}

// What Listen is set to do, for its tooltip: "find the ayah, follow the reciter and read the translation aloud"
function listenDoes() {
  const steps = ['find the ayah'];
  if (settings.get('listenFollow')) steps.push('follow the reciter');
  if (settings.get('listenRead') && canRead()) steps.push('read the translation aloud');
  return steps.length > 1 ? `${steps.slice(0, -1).join(', ')} and ${steps.at(-1)}` : steps[0];
}

function renderAyah() {
  els.ayahControls.hidden = !state.surah;
  // "Ayah " goes when the screen's too narrow for it (see style.css)
  const word = Object.assign(document.createElement('span'), { className: 'word', textContent: 'Ayah ' });
  els.ayah.replaceChildren(word, state.surah?.verses && state.ayah ? `${state.ayah} of ${state.surah.verses.length}` : '–');
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

const SCALES = { textSize: '--text-scale', arabicSize: '--arabic-scale', translationSize: '--translation-scale' };

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
  if (key.startsWith('voice-')) {
    renderReading();
    if (key === `voice-${settings.get('translation')}`) reader.again();
    return;
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
    case 'listenFollow':
    case 'listenRead':
      return renderListenButtons();
    case 'translation':
      if (value === 'none' && state.reading) stopReading();
      renderReading();
      renderListenButtons();
      if (state.surah) showSurah(state.surah.number, state.ayah);
      return;
    case 'tajweed':
    case 'tajweedKey':
      return renderTajweed();
    case 'source':
      els.source.value = value;
      return;
    case 'readingSpeed':
      renderReading();
      reader.again();
      return;
  }
}

function describeStartError(err) {
  if (err.name === 'NotAllowedError') return 'the microphone wasn’t allowed';
  if (err.name === 'NotFoundError') return 'no microphone found';
  return err.message;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// --- wiring -----------------------------------------------------------------

els.listen.addEventListener('click', () => (listener.active ? stop() : start()));
els.source.addEventListener('change', () => settings.set('source', els.source.value));
els.read.addEventListener('click', toggleReading);
els.readSpeed.addEventListener('click', nextSpeed);
els.openSettings.addEventListener('click', () => settingsPanel.show());
els.openSurahs.addEventListener('click', () => surahPicker.show(state.surah?.number ?? null));
surahPicker.onPick = pickSurah;
settingsPanel.onTutorial = () => tutorial.show();
settingsPanel.onHistory = () => surahPicker.show(state.surah?.number ?? null, 'heard');
els.scope.addEventListener('click', () => {
  if (!state.surah) return;
  state.scope = state.scope === state.surah.number ? null : state.surah.number;
  renderScope();
});
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
  state.placed = true;
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || settingsPanel.open || surahPicker.open || tutorial.open || e.target.closest?.('select, input')) return;
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
if (settings.get('translation') !== 'none' && !translation(settings.get('translation'))) settings.set('translation', 'en'); // one we no longer offer
for (const key of Object.keys(settings.DEFAULTS)) applySetting(key);
renderListenButtons();
reset();
setStatus('idle');
warmUpQuran().catch(() => {}); // start loading the model now
// Which translations can be read aloud depends on the device's voices, which
// can change while the app's away (a voice installed in Android's settings).
const voicesChanged = () => {
  renderReading();
  renderListenButtons();
  settingsPanel.refresh();
};
refreshVoices().then(voicesChanged);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshVoices().then(voicesChanged));
if (!tutorial.seen) tutorial.show(); // the first time
