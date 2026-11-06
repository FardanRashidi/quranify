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
// Following: seconds without placing the reciter before the verses dim, once a check
// has come back without hearing them. (A slow check on its way doesn't count: on a
// phone that takes a few seconds a check, waiting for one isn't not hearing them.)
const LOST_AFTER = 12;
// Looking back over the audio kept for the end of the surah the reciter's left: at most
// this much (all the speech model takes at once), and at least this much to be worth it.
const LOOK_BACK_MAX = 28;
const LOOK_BACK_MIN = 2;
const CHECK_MEMORY = 0.3; // how much each check's time moves the running average of how long they take
// The voice reading aloud through the speaker stops too: a pause this soon after is the voice's, not the reciter's.
const VOICE_TAIL = 1000; // ms
// Following, an ayah the reciter hasn't been heard in yet (moved on to as they finished the
// one before) is only read once they're heard carrying on, for this long: when they stop
// there, it isn't read.
const CARRIED_ON = 0.4; // s
const BASMALA_WORDS = 4;
// A Basmala heard with the reciter this many ayahs or fewer from the end of the surah: they finished it
const FINISH_LEFT = 2;
// The most surahs it reads on the way to the one the reciter's turned up in, and their words
const MAX_VIA = 2;
const MAX_VIA_WORDS = 60;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2]; // what the reading speed button steps through
// Reading every ayah while following: this much faster for each ayah the
// reciter is ahead, up to the most. Further behind than that, it skips to them.
const CATCH_UP = 0.1;
const MAX_CATCH_UP = 1.5;
const MAX_BEHIND = 10;
const NAME = 'Quran Whisperer';
const METER_BARS = 5;
const METER_MIN = 0.15; // of a bar's height, so it shows when it's quiet
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
  listenSub: $('listen-sub'),
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
  heardReciting: 0, // and the listener's recitingSeconds at the end of its audio
  missed: 0, // checks since then that didn't hear them (too quiet, or no ayah matched)
  basmalaAt: -Infinity, // when the audio of the last check that heard the Basmala (the start of a surah) ended
  basmalaReciting: 0, // and the listener's recitingSeconds then
  checkSeconds: null, // how long a check takes, from the end of its audio to the answer (running average)
  clipEndedAt: -Infinity, // when the audio for the latest check ended
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
  // Following, the reciter's gone on to another surah while the reading finishes this one:
  // { surah, ayah } where they are, `from` the ayah to read it from, `until` the last ayah here to read first.
  handover: null,
  awaiting: null, // following: the ayah to read next, once the reciter's heard carrying on to it (see reached)
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
  listener.onPause = onPause;
  listener.isDeaf = voiceSpeaking;
  state.session++;
  state.following = follow;
  state.lastRead = null;
  state.readOnFind = settings.get('listenRead') && !state.reading;
  state.listenStartedAt = performance.now();
  state.heardReciting = 0; // the listener counts from 0 again
  state.missed = 0;
  state.basmalaAt = -Infinity;
  state.handover = null;
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
  state.handover = null; // stays on the surah on screen
  // Reading along with the reciter has nothing more to go on.
  if (state.following && state.reading) stopReading();
  listener.stop();
  state.session++;
  state.following = false;
  state.readOnFind = false;
  clearTimeout(state.timer);
  state.busy = false;
  els.source.disabled = false;
  for (const bar of els.meter.children) bar.style.transform = '';
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
    state.clipEndedAt = clip.endedAt;
    if (clip.audible < (state.scope ? MIN_AUDIBLE_IN_SURAH : MIN_AUDIBLE)) return miss('Too quiet');
    const warm = state.quranReady && !state.loadingModel; // the model's loaded: this check's time is its own
    await warmUpQuran();
    if (session !== state.session) return;
    const match = await api.recognizeQuran(clip.pcm, follower.word ?? state.searchFrom, state.scope);
    if (session !== state.session) return;
    state.errors = 0;
    if (warm) {
      const took = (performance.now() - clip.endedAt) / 1000;
      state.checkSeconds = state.checkSeconds === null ? took : state.checkSeconds + CHECK_MEMORY * (took - state.checkSeconds);
    }
    if (!match) return miss('No ayah matched yet');
    if (match.basmala || match.afterBasmala) {
      // A surah's beginning: on its own it hears the reciter, but not where (nearly every surah starts so)
      state.basmalaAt = clip.endedAt;
      state.basmalaReciting = clip.recitingSeconds;
    }
    if (match.basmala) {
      state.note = 'A surah is starting';
      finishSurah();
      return schedule(follower.found ? settings.get('followMin') : SEARCH_EVERY);
    }
    const lookingBack = onVerse(match, clip);
    if (lookingBack) {
      await lookingBack; // a second check, so it's busy till it's done
      if (session === state.session) schedule(nextDelay());
    }
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

/**
 * A check found the reciter.
 * @returns {Promise | undefined} a look back over the audio kept, when they've gone on to another surah
 */
function onVerse(match, clip) {
  const wasFound = follower.found;
  const was = { ...follower.heard, reciting: state.heardReciting }; // where they were last heard, before this
  const target = follower.take(match, clip.endedAt);
  state.note = '';
  if (!target) return schedule(nextDelay()); // following, and a phrase from elsewhere that could be either: stay put
  // A passage that's in more than one place: show the best guess dimmed and keep
  // listening until the reciter says something that settles it (or we run out of patience).
  state.unsure = target.unsure && performance.now() - state.listenStartedAt < settings.get('giveUpAfter') * 1000;
  if (!target.unsure) {
    state.heardAt = performance.now();
    state.heardReciting = clip.recitingSeconds;
    state.missed = 0;
  }
  state.placed = true;
  if (state.handover) {
    // Still in the surah they've gone on to, while the reading finishes the last one
    if (target.surah === state.handover.surah && !target.unsure) {
      state.handover.ayah = target.ayah;
      setStatus('following');
      return schedule(nextDelay());
    }
    state.handover = null; // somewhere else again
  }
  if (wasFound && !target.unsure && state.following && state.reading && settings.get('readEveryAyah') && state.surah?.verses && target.surah !== state.surah.number) {
    setStatus('following');
    const lookingBack = handOver(match, was, clip, target);
    if (!lookingBack) schedule(nextDelay());
    return lookingBack;
  }
  // Through short ayahs, it's where their pace says they are by now (the check's audio ended a moment ago)
  const ayah = !target.unsure && state.surah?.number === target.surah ? (follower.reckon(performance.now(), state.surah.verses, turnaround()) ?? target.ayah) : target.ayah;
  const moved = target.surah !== state.surah?.number || ayah !== state.ayah;
  // The reciter went somewhere that doesn't carry on from where they were: another
  // surah, or another part of this one (a repeat of the last few words still carries on).
  const jumped = wasFound && (target.surah !== state.surah?.number || !match.continues);
  if (state.surah?.number === target.surah) {
    if (jumped) state.lastRead = null;
    // Reading that's behind the reciter keeps the verse being read in view instead.
    setAyah(ayah, !(state.following && wasFound) ? true : readingLeads() ? false : 'follow');
  } else showSurah(target.surah, target.ayah);
  const startsReading = state.readOnFind && !state.unsure && !state.reading;
  if (!state.unsure) state.readOnFind = false;
  if (startsReading) startReading(fromTheTop(match, clip) ? 1 : undefined);
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

/**
 * Following, the reciter has paused near where the ayah should end: most likely,
 * they've just finished it. So it checks straight away, rather than when the next
 * check is due, and moves on to the next ayah in the pause, before they start it.
 * @param {number} stoppedAt when the sound stopped
 */
function onPause(stoppedAt) {
  if (!state.following || !follower.found || state.unsure || state.handover) return;
  // The voice reading aloud, between pieces, or as it stops
  if (micHearsReading() && (state.readingAyah !== null || stoppedAt < state.readEndedAt + VOICE_TAIL)) return;
  if (state.clipEndedAt >= stoppedAt) return; // a check has already heard the pause
  const verse = followedVerse();
  if (!follower.nearEnd(performance.now(), verse)) return; // a breath partway through
  // At their pace they'd have finished it: on to the next, without waiting for the check to say so.
  // Not when the voice has read aloud through the speaker since they were placed: they could be anywhere.
  const missedSome = micHearsReading() && state.readEndedAt > (follower.heard?.at ?? -Infinity);
  const ahead = verse && !missedSome ? follower.anticipate(stoppedAt, verse, state.surah.verses.length) : null;
  if (ahead && ahead.ayah > state.ayah) moveAlong(ahead.ayah);
  syncNow(); // or straight after the check that's under way
}

/** Following in the surah on screen: the highlight, and the reading, go on to `ayah` without a check placing them there. */
/**
 * A check heard the Basmala with the reciter in the last few ayahs of the surah on
 * screen: they've finished it and are starting the next. So the highlight goes to its
 * last ayah, and the reading finishes it, without waiting to hear them in the next.
 */
function finishSurah() {
  const verses = state.surah?.verses;
  if (!state.following || !follower.found || state.handover || !verses || follower.at?.surah !== state.surah.number) return;
  if (nearItsEnd(state.surah, follower.at.ayah) && state.ayah < verses.length) moveAlong(verses.length);
}

// Whether ayah `ayah` is in the last FINISH_LEFT of `surah`'s, so a Basmala after it means they finished it
function nearItsEnd(surah, ayah) {
  return surah.verses.length - ayah <= FINISH_LEFT;
}

/**
 * Found in a surah they were heard beginning (its Basmala, since it started listening),
 * and no further in than they could have got since: they've recited it from the top.
 * Their pace is only a first guess yet, so it goes by the most they could have said
 * (Al-Fatiha, found at its fourth ayah after its Basmala, is 14 words in).
 */
function fromTheTop(match, clip) {
  if (match.ayah <= 1 || state.basmalaAt < state.listenStartedAt) return false;
  return match.word - match.surahStart + 1 <= follower.reachIn(clip.recitingSeconds - state.basmalaReciting);
}

function moveAlong(ayah) {
  setAyah(ayah, readingLeads() ? false : 'follow');
  if (!state.reading) return;
  if (state.readingAyah !== null) {
    reader.boost = catchUp();
    return;
  }
  const next = nextToRead();
  if (next !== null) readAloud(next);
}

// Seconds from one check to the next, at the quickest: how long one takes here, plus the shortest wait.
function turnaround() {
  return (state.checkSeconds ?? 1) + settings.get('followMin');
}

// --- from one surah to another ----------------------------------------------

/**
 * Following and reading every ayah, the reciter has turned up in another surah while
 * the reading's still in the one on screen. If they finished it (the check heard its
 * end, or they had time to say the rest: at their pace, over the time they've been
 * reciting since, not counting a stop), the reading finishes it too before going on
 * with them. Otherwise it reads up to the ayah they were last heard in. When it's only
 * that they had time, it looks back over the audio kept to see. The new surah is read
 * from its first ayah if they had time for that much of it as well, or a check heard
 * its Basmala; otherwise from where they were found: in a long surah, a good way in,
 * they've jumped there.
 * @returns {Promise | undefined} the look back, if there is one
 */
function handOver(match, was, clip, target) {
  const from = state.surah;
  const first = from.verses[0].firstWord;
  const last = from.verses.at(-1);
  const end = last.firstWord + last.words - 1;
  if (!(was.word >= first && was.word <= end)) return void goOn({ ...target, from: target.ayah, until: 0 });
  const could = follower.saidIn(clip.recitingSeconds - was.reciting); // words they had time to say since
  const left = end - was.word; // of this surah, the words they hadn't said yet
  const into = match.word - match.surahStart + 1; // of the new one, from its start to where the check heard them
  const said = match.word - match.start + 1; // and of those, the ones the check heard
  const spans = match.start <= end && match.start >= first; // the check heard this one end and the next begin
  // The Basmala heard since: they started the new one from the top (and it took about 4 words' time)
  const basmala = state.basmalaAt > was.at;
  const byBasmala = basmala && nearItsEnd(from, ayahOfWord(from, was.word)); // in its last ayahs, then the next one's Basmala
  const finished = spans || left <= 1 || byBasmala || left + said + (basmala ? BASMALA_WORDS : 0) <= could;
  const topAlone = basmala || into <= could; // could have said the new one from its start, if they didn't finish this one
  // Gone on to the surah after next (Al-Ikhlas to An-Nas, say): they recited the short one
  // in between too, while the microphone wasn't listening, if they had time for all of it.
  const skipped = target.surah - from.number - 1;
  const between = match.surahStart - end - 1; // its words (the text's in the mushaf's order)
  const via = finished && skipped >= 1 && skipped <= MAX_VIA && between <= MAX_VIA_WORDS && left + between + BASMALA_WORDS * skipped + into <= could;
  const plan = {
    surah: target.surah,
    ayah: target.ayah,
    from: via || spans || basmala || (finished ? left : 0) + into <= could ? 1 : target.ayah,
    until: finished ? from.verses.length : ayahOfWord(from, was.word),
    via: via ? Array.from({ length: skipped }, (_, i) => from.number + 1 + i) : [], // the surahs in between, to read on the way
  };
  state.handover = plan;
  readOn();
  if (finished && !spans && !byBasmala && left > 1) return lookBackFor(plan, from, was, clip, topAlone);
}

/**
 * Looks back over the audio kept, from when the reciter was last heard in `from` to
 * the start of the check that found them in the next surah, for how far they got.
 * If they stopped before its end, the reading stops there too.
 * @param {boolean} topAlone they could have said the new surah from its start since
 */
async function lookBackFor(plan, from, was, clip, topAlone) {
  if (state.handover !== plan) return; // nothing left to read there anyway
  // The microphone heard the voice reading aloud meanwhile, over the reciter: it goes by the time
  if (micHearsReading() && state.readEndedAt > was.at - 1000) return;
  const endAt = clip.endedAt - clip.duration * 1000 + 2000; // a little into that check's audio
  const seconds = Math.min((endAt - was.at) / 1000 + 1, LOOK_BACK_MAX);
  if (seconds < LOOK_BACK_MIN) return;
  try {
    const audio = await listener.clip(seconds, endAt);
    if (audio.audible < MIN_AUDIBLE_IN_SURAH || state.handover !== plan) return;
    const heard = await api.recognizeQuran(audio.pcm, was.word, from.number);
    if (!heard || heard.basmala || state.handover !== plan || state.surah !== from) return;
    const last = from.verses.at(-1);
    if (heard.word >= last.firstWord + last.words - 2) return; // they got to its end (or all but the last word)
    plan.until = Math.max(heard.ayah, ayahOfWord(from, was.word));
    plan.from = topAlone ? 1 : plan.ayah;
    plan.via = []; // nor any in between, then
    readOn();
  } catch (err) {
    console.error(err); // it goes by the time, then
  }
}

// During a handover: reads on to `until`, then goes to the surah the reciter's in.
function readOn() {
  const plan = state.handover;
  setAyah(Math.max(plan.until, 1), readingLeads() ? false : 'follow');
  if (state.readingAyah !== null && state.readingAyah > plan.until) return goOn(); // one they didn't get to: dropped
  if (state.readingAyah !== null) return; // reading one: readAloud carries on from it
  const next = plan.until ? nextToRead() : null;
  if (next !== null) readAloud(next);
  else goOn();
}

// To the surah the reciter's in, reading it from where the handover says (after any on the way, from the top).
function goOn(plan = state.handover) {
  if (plan.via?.length) {
    const [next, ...rest] = plan.via;
    state.handover = { ...plan, via: rest, until: Infinity };
    return showSurah(next, Infinity, 1); // the highlight at its end, as they've finished it
  }
  state.handover = null;
  const ayah = follower.at?.surah === plan.surah ? follower.at.ayah : plan.ayah;
  showSurah(plan.surah, ayah, plan.from);
}

// A surah's English name for the status line, once the list has loaded (it loads the first time it's asked)
const surahNames = new Map();
let surahList = null;
function surahName(number) {
  surahList ??= api
    .fetchSurahs()
    .then((list) => list.forEach((s) => surahNames.set(s.number, s.englishName)))
    .catch(() => (surahList = null));
  return surahNames.get(number) ?? `surah ${number}`;
}

// The ayah of `surah` that a global word index is in
function ayahOfWord(surah, word) {
  const i = surah.verses.findIndex((v) => word < v.firstWord + v.words);
  return i < 0 ? surah.verses.length : i + 1;
}

function miss(reason) {
  state.note = reason;
  state.missed++;
  // Give up after a while without finding the reciter (or, following, without hearing them).
  if (performance.now() - listeningSince() > settings.get('giveUpAfter') * 1000) {
    state.note = follower.found ? 'Lost the reciter' : 'Couldn’t find the ayah';
    return stop();
  }
  schedule(nextDelay());
}

function nextDelay() {
  if (!state.following || !follower.found) return SEARCH_EVERY;
  return follower.delay(performance.now(), followedVerse(), { min: settings.get('followMin'), max: settings.get('followMax') });
}

// The ayah the follower has the reciter on, once its surah has loaded
function followedVerse() {
  const { surah, ayah } = follower.at;
  return state.surah?.number === surah ? state.surah.verses?.[ayah - 1] : undefined;
}

/** Following, but nothing has placed the reciter for a while. */
function lost() {
  if (!state.following || !follower.found || (micHearsReading() && state.readingAyah !== null)) return false;
  return state.missed > 0 && performance.now() - listeningSince() > LOST_AFTER * 1000;
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

function startReading(from = state.ayah) {
  if (!canRead()) return;
  state.reading = true;
  state.readError = '';
  state.lastRead = null;
  readAloud(from);
}

/**
 * (Re)starts reading, from the ayah on screen unless told otherwise. On its own it
 * carries on to the end of the surah. Following, it reads each ayah once the
 * reciter has reached it: every one in turn, or (with read every ayah off) the
 * one they're on, skipping any they've passed.
 */
async function readAloud(from = state.ayah) {
  const session = pauseReading();
  state.awaiting = null;
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
      if (next === null && state.handover) return goOn(); // read as far as they got here: on to where they are
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
  const next = ayahToRead();
  state.awaiting = next !== null && !reached(next) ? next : null; // frame() reads it once they carry on
  return state.awaiting === null ? next : null;
}

function ayahToRead() {
  const last = state.lastRead;
  if (last === null || !settings.get('readEveryAyah')) return state.ayah !== last ? state.ayah : null;
  // Behind the last one read: a repeat (a jump back would have cleared `last`), so wait for them to come past it.
  if (state.ayah <= last) return null;
  if (state.ayah - last > MAX_BEHIND) return state.ayah; // too far behind to catch up: join them
  return last + 1;
}

/**
 * Following: whether the reciter has got to ayah `n` of the surah on screen, rather than
 * only being expected to (having finished the one before): heard in it or past it, or
 * heard carrying on since they were last placed, not counting the voice reading aloud.
 */
function reached(n) {
  const verse = state.surah?.verses?.[n - 1];
  const heard = follower.heard;
  if (!verse || !heard || state.handover || follower.at?.surah !== state.surah.number || heard.word >= verse.firstWord) return true;
  const since = Math.max(heard.at, micHearsReading() ? state.readEndedAt + VOICE_TAIL : -Infinity);
  return listener.soundSince(since) >= CARRIED_ON;
}

// What the microphone hears is the voice reading aloud through the speaker (or its echo dying away)
function voiceSpeaking() {
  return micHearsReading() && (state.readingAyah !== null || performance.now() < state.readEndedAt + VOICE_TAIL);
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
  if (state.handover) goOn(); // nothing more to read here: on to where the reciter is
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
  versesView.message(listener.active ? 'Listening for the recitation…' : 'Press Listen or choose a surah to read.');
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

/** @param {number} [readFrom] reading aloud, the ayah to read from once it's loaded (else the one on screen) */
async function showSurah(number, ayah, readFrom = null) {
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
    if (state.reading) readAloud(readFrom ?? state.ayah);
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
  state.handover = null; // the reader's chosen where to be
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
    listener.levels(METER_BARS).forEach((level, i) => (els.meter.children[i].style.transform = `scaleY(${Math.max(METER_MIN, level)})`));
  }
  // Through short ayahs, on by the reciter's pace between checks
  if (state.following && follower.found && !state.unsure && !state.handover && state.surah?.verses && state.surah.number === follower.at.surah) {
    const ayah = follower.reckon(performance.now(), state.surah.verses, turnaround());
    if (ayah > state.ayah) moveAlong(ayah);
  }
  // The next ayah to read, once the reciter carries on to it
  if (state.awaiting !== null && state.following && state.reading && state.readingAyah === null && reached(state.awaiting)) {
    const next = nextToRead();
    if (next !== null) readAloud(next);
  }
  renderStale();
  setText(els.status, statusText());
}

function statusText() {
  if (state.loadingModel) return modelLoadingText();
  if (state.unsure) return 'This passage is in more than one place. Listening a bit more…';
  if (state.following && follower.found && state.handover && state.surah?.verses) {
    const { surah, until } = state.handover;
    const rest = until >= state.surah.verses.length ? 'to its end' : `up to ayah ${until}`;
    return `Following: on to ${surahName(surah)}, ayah ${follower.at.ayah} · Reading ${state.surah.englishName} ${rest} first`;
  }
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
  return state.surah ? 'Stopped. Press Listen to start again' : 'Ready. Press Listen or choose a surah';
}

function setStatus(status) {
  state.status = status;
  document.body.dataset.status = status;
  renderListenButtons();
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
  els.listenSub.textContent = !listener.active ? '' : state.status === 'following' ? 'Following' : 'Listening…';
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
els.meter.append(...Array.from({ length: METER_BARS }, () => document.createElement('i')));
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
