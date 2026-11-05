// The recorded English translation: Ibrahim Walk reading Saheeh International (the
// translation shown), one file per ayah from alquran.cloud's CDN, or from the phone
// for a surah that's been saved (saved-voice.js). When each word is said comes from
// data/walk-timings.json (walk.js), so the word being read can be highlighted as
// with a device voice.
import { loadTimings, ayahNumber, audioUrl } from './walk.js';
import { savedCopy } from './saved-voice.js';

const SKIP_SILENCE = 0.4; // s: a file that starts with more silence than this starts just before the sound
const LEAD_IN = 0.15; // s: how long before the sound that is
const TAIL = 0.15; // s after the sound ends to call it finished, rather than playing the silence after it
const START_WITHIN = 10; // s: a recording that hasn't started by then (a bad connection) is left to another voice
// A tenth of a second of silence: an 8 kHz 8-bit WAV.
const SILENCE = `data:audio/wav;base64,${btoa(
  String.fromCharCode(
    ...[0x52, 0x49, 0x46, 0x46, 0x44, 0x03, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, 16, 0, 0, 0, 1, 0, 1, 0],
    ...[0x40, 0x1f, 0, 0, 0x40, 0x1f, 0, 0, 1, 0, 8, 0, 0x64, 0x61, 0x74, 0x61, 0x20, 0x03, 0, 0],
    ...new Array(800).fill(0x80),
  ),
)}`;

/** Whether this browser can play the recording (it needs the internet too, for a surah that isn't saved). */
export const supported = typeof Audio !== 'undefined';

let current = null; // { audio, finish(result) } for what's playing
// Two players take turns: one plays an ayah while the other loads the next. The
// same two throughout, because Safari only lets a player that was started by a
// tap play sound, and the reading starts later (once Listen has found the ayah).
const players = supported ? [newAudio(), newAudio()] : [];
let next = null; // { n, audio, loading }: the ayah loading ahead, and a promise of its source being set

/**
 * Plays an ayah's recording, stopping anything already playing.
 * @param {{ surah: number, ayah: number }} place
 * @param {string} text the ayah's translation, for `onWord`
 * @param {{ rate: number, onWord?: (start: number, end: number) => void }} options
 *   `onWord` gets each word's place in `text` as it's said
 * @returns {Promise<boolean | null>} true once it's been read to the end, false if it was
 *   stopped, null if it couldn't be played (offline, say), so another voice can read it
 */
export async function play({ surah, ayah }, text, { rate, onWord }) {
  stop();
  const entry = { audio: null, finish: null };
  current = entry;
  let data;
  try {
    data = await loadTimings();
  } catch (err) {
    console.warn(err);
    return current === entry ? ((current = null), null) : false;
  }
  if (current !== entry) return false;

  const n = ayahNumber(data, surah, ayah);
  const words = [...text.matchAll(/\S+/g)];
  const timing = data.ayahs[n - 1];
  // Without timings that fit the text (a different translation text, say), it still plays, just unhighlighted.
  const times = timing?.w.length === words.length ? timing.w : null;
  let audio, loading;
  if (next?.n === n && !next.audio.error) ({ audio, loading } = next);
  else {
    audio = players.find((p) => p !== next?.audio);
    loading = load(audio, data, n);
  }
  next = null;
  await loading;
  if (current !== entry) return false;
  entry.audio = audio;
  // Where the sound starts, or the first word if that's earlier: never past anything that can be heard.
  const start = Math.min(timing?.s ?? 0, times?.find((t) => t !== null) ?? Infinity) / 100;
  audio.currentTime = start > SKIP_SILENCE ? start - LEAD_IN : 0;
  audio.defaultPlaybackRate = audio.playbackRate = rate;
  // The next ayah, on the other player, so reading on doesn't wait for it to download.
  if (n < data.ayahs.length) {
    const other = players.find((p) => p !== audio);
    next = { n: n + 1, audio: other, loading: load(other, data, n + 1) };
  }

  return new Promise((resolve) => {
    let word = -1;
    let frame = 0;
    const tick = () => {
      const now = audio.currentTime * 100;
      if (times) {
        let i = word;
        while (i + 1 < times.length && (times[i + 1] === null || times[i + 1] <= now)) i++;
        // Punctuation on its own has no time; the highlight stays on the word before it.
        while (i > word && times[i] === null) i--;
        if (i > word && times[i] !== null) {
          word = i;
          onWord?.(words[i].index, words[i].index + words[i][0].length);
        }
      }
      if (timing && now > timing.e + TAIL * 100) finish(true);
    };
    const playing = () => entry.finish === finish;
    const loop = () => {
      if (!playing()) return;
      tick();
      frame = requestAnimationFrame(loop);
    };
    const ended = () => finish(true);
    const failed = () => finish(null);
    const slow = setTimeout(failed, START_WITHIN * 1000); // cleared once it starts
    const finish = (result) => {
      if (!playing()) return;
      entry.finish = null;
      if (current === entry) current = null;
      cancelAnimationFrame(frame);
      clearTimeout(slow);
      audio.removeEventListener('timeupdate', tick);
      audio.removeEventListener('ended', ended);
      audio.removeEventListener('error', failed);
      audio.pause();
      resolve(result);
    };
    entry.finish = finish;
    audio.addEventListener('timeupdate', tick); // keeps time when the page is hidden and frames stop
    audio.addEventListener('ended', ended);
    audio.addEventListener('error', failed);
    audio.play().then(
      () => {
        clearTimeout(slow);
        frame = requestAnimationFrame(loop);
      },
      (err) => {
        if (!playing()) return; // stopped before it started
        console.warn(err);
        finish(null);
      },
    );
  });
}

/** The speed, changed while it's playing. */
export function setRate(rate) {
  if (current?.audio) current.audio.playbackRate = rate;
}

export function stop() {
  current?.finish?.(false);
  current = null;
}

const loads = new WeakMap(); // player → the ayah it was last told to load

/** Points a player at ayah `n`: its copy saved on the phone, or else the internet. */
async function load(audio, data, n) {
  loads.set(audio, n);
  const saved = await savedCopy(n).catch((err) => {
    console.warn(err);
    return null;
  });
  if (loads.get(audio) !== n) {
    // told to load another meanwhile
    if (saved) URL.revokeObjectURL(saved);
    return;
  }
  if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
  audio.src = saved ?? audioUrl(data, n);
}

function newAudio() {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.preservesPitch = true; // faster or slower, not higher or lower
  return audio;
}

// At the first tap or key press, a moment of silence on each player, so Safari lets them play later.
if (supported) {
  const unlock = () => {
    removeEventListener('pointerdown', unlock, true);
    removeEventListener('keydown', unlock, true);
    for (const audio of players) {
      if (audio.src) continue; // already in use, so already allowed
      audio.src = SILENCE;
      audio.play().then(
        () => audio.src === SILENCE && audio.pause(),
        () => {},
      );
    }
  };
  addEventListener('pointerdown', unlock, true);
  addEventListener('keydown', unlock, true);
}
