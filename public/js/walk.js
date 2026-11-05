// Ibrahim Walk's recording of the English translation: where each ayah's file
// is, how big it is, and when each word is said in it (data/walk-timings.json,
// made by scripts/walk-timings.mjs). recording.js plays it, and saved-voice.js
// keeps it on the phone for offline.
const TIMINGS = 'data/walk-timings.json';
// A file's size from how long its sound lasts (the files are 64 kbit/s MP3s).
// Fitted to 60 of them: each within 13%, and about 520 MB for the whole Quran.
const BYTES_PER_SECOND = 8100;
const BYTES_PER_FILE = 3500;

let timings = null; // promise of the parsed file

/**
 * @returns {Promise<{ audio: string, surahStarts: number[], ayahs: { w: (number | null)[], s: number, e: number }[] }>}
 *   `audio` is the files' URL, with {n} for the ayah's number
 */
export function loadTimings() {
  timings ??= fetch(TIMINGS)
    .then((res) => {
      if (!res.ok) throw new Error(`couldn't load ${TIMINGS} (HTTP ${res.status})`);
      return res.json();
    })
    .catch((err) => {
      timings = null; // try again next time
      throw err;
    });
  return timings;
}

/** An ayah's number in the recording, counting from 1 at 1:1, as its files are. */
export const ayahNumber = (data, surah, ayah) => data.surahStarts[surah - 1] + ayah;

/** A surah's first and last numbers in the recording. */
export const surahAyahs = (data, surah) => [data.surahStarts[surah - 1] + 1, data.surahStarts[surah] ?? data.ayahs.length];

export const audioUrl = (data, n) => data.audio.replace('{n}', n);

/** About how many bytes ayahs `from`–`to` take. */
export function estimateBytes(data, from, to) {
  let bytes = 0;
  for (let n = from; n <= to; n++) bytes += BYTES_PER_FILE + (BYTES_PER_SECOND * data.ayahs[n - 1].e) / 100;
  return bytes;
}
