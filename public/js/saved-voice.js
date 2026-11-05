// The recorded voice kept on the phone, so the English translation can be read
// aloud without the internet: which surahs are saved, saving and deleting them,
// and an ayah's saved copy for recording.js to play. Only the app can save it
// (SavedVoicePlugin.java); a browser always streams it. Each ayah is its own
// file, so a surah can be partly saved (a save that was stopped, or cut off).
import { savedVoice as native } from './api.js';
import { loadTimings, surahAyahs, estimateBytes } from './walk.js';

export const supported = Boolean(native.supported);

let listed = null; // promise of what's saved: { path, ayahs: Set<number>, bytes }
let known = null; // the same, once it's arrived
let data = null; // the timings, once loaded: each surah's ayahs, and the files' URL
let sizes = null; // each surah's size, about, in bytes (index 0 is surah 1)
const jobs = new Map(); // surah → { id, started }: being saved, or waiting its turn
const errors = new Map(); // surah → why it couldn't be saved, the last time
const listeners = new Set();
let uid = 0;

if (supported) {
  native.listen(
    ({ id }) => {
      for (const job of jobs.values()) if (job.id === id) job.started = true;
      changed();
    },
    ({ ayah, bytes }) => {
      if (known && !known.ayahs.has(ayah)) {
        known.ayahs.add(ayah);
        known.bytes += bytes;
      }
      changed();
    },
  );
}

/** Calls `listener` whenever what's saved, or being saved, changes. */
export function onChange(listener) {
  listeners.add(listener);
}

function changed() {
  for (const listener of listeners) listener();
}

function list() {
  listed ??= native.status().then(
    ({ path, ayahs, bytes }) => (known = { path, ayahs: new Set(ayahs), bytes }),
    (err) => {
      listed = null;
      throw err;
    },
  );
  return listed;
}

/** Finds out what's saved (once), so `surah` and `summary` can say. */
export async function load() {
  if (!supported) return;
  const [timings] = await Promise.all([loadTimings(), list()]);
  if (!data) {
    data = timings;
    sizes = Array.from({ length: 114 }, (_, i) => estimateBytes(data, ...surahAyahs(data, i + 1)));
  }
}

/** Whether `load` has finished, so the rest can answer. */
export const loaded = () => Boolean(known && data);

function countSaved(number) {
  const [from, to] = surahAyahs(data, number);
  let saved = 0;
  for (let n = from; n <= to; n++) if (known.ayahs.has(n)) saved++;
  return { saved, total: to - from + 1 };
}

/**
 * A surah: how many of its ayahs are saved, of how many; about how many bytes all
 * of them take; whether it's being saved ('saving') or waiting its turn
 * ('waiting'); and why it couldn't be saved, if it couldn't the last time.
 */
export function surah(number) {
  const job = jobs.get(number);
  return { ...countSaved(number), bytes: sizes[number - 1], job: job ? (job.started ? 'saving' : 'waiting') : null, error: errors.get(number) ?? '' };
}

/** All of it: surahs saved in full, bytes saved, and surahs being saved or waiting to be. */
export function summary() {
  let surahs = 0;
  for (let number = 1; number <= 114; number++) {
    const { saved, total } = countSaved(number);
    if (saved === total) surahs++;
  }
  return { surahs, bytes: known.bytes, saving: jobs.size };
}

/** About how many more bytes saving these surahs would take (what's saved already isn't saved again). */
export function sizeToSave(numbers) {
  let bytes = 0;
  for (const number of numbers) {
    const { saved, total } = countSaved(number);
    bytes += sizes[number - 1] * (1 - saved / total);
  }
  return bytes;
}

/** Saves these surahs, in turn, after any already being saved. A failure stops them all. */
export async function save(numbers) {
  await load();
  errors.clear(); // trying again
  for (const number of numbers) {
    const { saved, total } = countSaved(number);
    if (jobs.has(number) || saved === total) continue;
    const job = { id: `${number}-${++uid}`, started: false };
    jobs.set(number, job);
    errors.delete(number);
    native
      .save(job.id, data.audio, ...surahAyahs(data, number))
      .catch((err) => {
        console.warn(err);
        if (jobs.get(number) !== job) return; // stopped meanwhile
        errors.set(number, describe(err));
        stop(); // most likely the internet, so the rest would fail too
      })
      .finally(() => {
        if (jobs.get(number) === job) jobs.delete(number);
        changed();
      });
  }
  changed();
}

/** Stops saving a surah, or without one, every surah. What's saved so far is kept. */
export function stop(number) {
  if (number === undefined) {
    jobs.clear();
    native.cancel().catch((err) => console.warn(err));
  } else {
    const job = jobs.get(number);
    if (!job) return;
    jobs.delete(number);
    native.cancel(job.id).catch((err) => console.warn(err));
  }
  changed();
}

/** Deletes a surah's saved ayahs, or without one, all of them. */
export async function remove(number) {
  await load();
  stop(number);
  if (number === undefined) {
    errors.clear();
    await native.remove();
  } else {
    errors.delete(number);
    await native.remove(...surahAyahs(data, number));
  }
  listed = null;
  await list();
  changed();
}

/**
 * Ayah `n`'s saved copy (numbered from 1 at 1:1) as a blob: URL to play, or null
 * if it isn't saved. Revoke it once it's done with.
 */
export async function savedCopy(n) {
  if (!supported) return null;
  const { path, ayahs } = await list();
  if (!ayahs.has(n)) return null;
  // Read whole rather than played from its file URL: Capacitor answers a range request
  // (which seeking makes) with the file from its start, labelled as the range.
  const res = await fetch(native.fileUrl(path, n));
  if (!res.ok) throw new Error(`couldn't read the saved ayah ${n} (HTTP ${res.status})`);
  return URL.createObjectURL(await res.blob());
}

function describe(err) {
  const message = String(err?.message ?? err);
  if (/space|ENOSPC/i.test(message)) return 'There’s no room left on this phone.';
  return 'Couldn’t download it. Check the internet connection and try again.';
}
