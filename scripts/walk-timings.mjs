// Word timings for the recorded English translation: Ibrahim Walk reading Saheeh
// International (alquran.cloud's `en.walk`, one file per ayah). An English Whisper
// (whisper-base.en, with word timestamps) listens to each file, and the words it
// hears are lined up with the `en.sahih` text the app shows, so reading aloud can
// highlight each word as it's said. Run it once (a couple of hours on a desktop);
// the result is committed, so the server and the app never run this model.
//
//   npm run walk-timings                  → public/data/walk-timings.json
//   npm run walk-timings -- 20            just the next 20 ayahs (to try it out)
//   npm run walk-timings -- --workers 2   fewer side by side (for less memory: 1.7 GB each)
//
// Progress is kept in .cache/walk-timings/, so a run that's stopped carries on
// where it left off. report.tsv there lists how well each ayah lined up.
import { execFileSync, fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { pipeline, env } from '@huggingface/transformers';
import { downloadEdition } from '../lib/quran.js';
import { dataPath } from '../server/paths.js';

const AUDIO = 'https://cdn.islamic.network/quran/audio/192/en.walk/{n}.mp3'; // n: 1–6236, counting from 1:1
const MODEL = 'Xenova/whisper-base.en'; // tiny.en heard as well, but put words 0.2–0.4 s late
const OUT = fileURLToPath(new URL('../public/data/walk-timings.json', import.meta.url));
const WORK = dataPath('.cache', 'walk-timings');
const PREFETCH = 4; // downloads ahead of the one being transcribed
// Workers transcribing side by side, each with its share of the CPU's threads.
// One on its own leaves much of the CPU idle while it writes out the words one at
// a time. On an 8-core Ryzen, four ran at 18× real time against one's 10×, and
// six were no faster.
const WORKERS = 4;
// Whisper now and then misses the first or last few words of an ayah, and they all
// get the time of the nearest word it heard. When those words sit this far (s)
// from where the sound starts or stops, they're spread out to fill the gap.
const SPREAD_OVER = 0.3;
const QUIET = 0.03; // sound means a 10 ms stretch within about 30 dB of the loudest

env.cacheDir = dataPath('.cache', 'models');

const surahs = await loadText();
const texts = surahs.flatMap((s) => s.ayahs);
const surahStarts = [];
for (let i = 0, n = 0; i < surahs.length; n += surahs[i++].ayahs.length) surahStarts.push(n);

await fs.mkdir(WORK, { recursive: true });
const progressFile = path.join(WORK, 'progress.jsonl');
const done = new Map();
await loadProgress();

const { values: options, positionals } = parseArgs({ allowPositionals: true, options: { workers: { type: 'string' } } });
// Every ayah without a finished entry. An entry without `s` (from before the
// script measured the sound) only needs its file measuring and its times fitting.
const finished = (i) => done.get(i)?.s !== undefined;
const todo = texts
  .map((_, i) => i)
  .filter((i) => !finished(i))
  .slice(0, Number(positionals[0]) || undefined);

// A worker (started below): its share of the ayahs, telling the main process as each is done.
if (process.env.WALK_SHARD) {
  const [k, n] = process.env.WALK_SHARD.split('/').map(Number);
  await transcribe(
    todo.filter((_, j) => j % n === k),
    Number(process.env.WALK_THREADS),
    (progress) => process.send(progress),
  );
  process.exit(0);
}

const before = texts.filter((_, i) => finished(i)).length;
console.log(`${texts.length} ayahs, ${before} done already`);
const workers = Math.max(1, Math.min(Number(options.workers) || WORKERS, todo.length));
const threads = Math.max(1, Math.floor(os.availableParallelism() / workers));
const startedAt = performance.now();
let count = 0;
let audioSeconds = 0;
const report = ({ i, seconds }) => {
  count++;
  audioSeconds += seconds;
  if (count % 50 === 0 || count === todo.length) {
    const elapsed = (performance.now() - startedAt) / 1000;
    const left = (elapsed / count) * (todo.length - count);
    console.log(`${before + count}/${texts.length} (${ref(i)}) · ${(audioSeconds / elapsed).toFixed(1)}× real time · about ${Math.round(left / 60)} min to go`);
  }
};
if (workers === 1) await transcribe(todo, threads, report);
else {
  console.log(`${workers} workers, ${threads} threads each`);
  const results = await Promise.allSettled(
    Array.from(
      { length: workers },
      (_, k) =>
        new Promise((resolve, reject) => {
          const child = fork(fileURLToPath(import.meta.url), process.argv.slice(2), {
            env: { ...process.env, WALK_SHARD: `${k}/${workers}`, WALK_THREADS: String(threads) },
          });
          child.on('message', report);
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${k + 1} stopped (exit code ${code})`))));
        }),
    ),
  );
  for (const r of results) if (r.status === 'rejected') console.error(r.reason.message);
  await loadProgress(); // what the workers saved
}

const left = texts.filter((_, i) => !finished(i)).length;
if (left) {
  console.log(`${left} ayahs still to do: run it again to carry on`);
  process.exit(0);
}

// One entry per ayah, in order, in hundredths of a second from the start of its
// file. `w` has a start time for each word of the ayah's text (split at spaces),
// or null for one that's only punctuation. `s` and `e` are where the sound starts
// and ends: the file has silence before and after.
const ayahs = texts.map((_, i) => {
  const { w, s, e } = done.get(i);
  return { w, s, e };
});
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(
  OUT,
  JSON.stringify({
    about: "Ibrahim Walk reading Saheeh International (alquran.cloud's en.walk): when each word of the en.sahih text is said. Made by scripts/walk-timings.mjs.",
    audio: AUDIO,
    surahStarts,
    ayahs,
  }),
);
console.log(`wrote ${OUT}`);

// --- transcribing ---------------------------------------------------------------

/** Times the words of the ayahs `todo` (indexes into `texts`), saving each one as it's done. */
async function transcribe(todo, threads, onDone) {
  const asr = await pipeline('automatic-speech-recognition', MODEL, {
    dtype: 'fp32',
    session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
  });
  const downloads = new Map();
  const fetchAhead = (k) => {
    for (let j = k; j < Math.min(todo.length, k + PREFETCH); j++) {
      if (!downloads.has(todo[j])) downloads.set(todo[j], download(todo[j] + 1));
    }
  };
  for (let k = 0; k < todo.length; k++) {
    const i = todo[k];
    fetchAhead(k);
    const mp3 = await downloads.get(i);
    downloads.delete(i);
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1'], {
      input: mp3,
      maxBuffer: 1 << 30,
    });
    const audio = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    const sound = soundBounds(audio);
    const old = done.get(i);
    let entry;
    if (old) {
      // Timed before the sound was measured: just fit the times to it.
      entry = { ...fit(texts[i], old.w, old.e / 100, sound), matched: old.matched };
    } else {
      const out = await asr(audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
      const heard = (out.chunks ?? []).map((c) => ({ key: key(c.text), start: c.timestamp[0], end: c.timestamp[1] }));
      entry = timings(texts[i], heard, audio.length / 16000, sound);
      await fs.appendFile(path.join(WORK, 'report.tsv'), `${ref(i)}\t${entry.matched}\t${texts[i]}\t${out.text.trim()}\n`);
    }
    done.set(i, entry);
    // Workers append to the same file: each line goes in one write, so lines don't get mixed up.
    await fs.appendFile(progressFile, JSON.stringify({ i, entry }) + '\n');
    onDone({ i, seconds: audio.length / 16000 });
  }
}

async function loadProgress() {
  let lines = [];
  try {
    lines = (await fs.readFile(progressFile, 'utf8')).split('\n');
  } catch {} // none yet
  for (const line of lines) {
    try {
      const { i, entry } = JSON.parse(line);
      done.set(i, entry);
    } catch {} // blank, or cut short by a run that was stopped; that ayah gets done again
  }
}

// --- lining up ----------------------------------------------------------------

/** The text's words, each given the time of the heard word it lines up with. */
function timings(text, heard, duration, sound) {
  const words = text.split(/\s+/).filter(Boolean);
  const keys = words.map(key);
  // Edit-distance alignment: a match or a substitution lines a word up with what was heard.
  const n = keys.length, m = heard.length;
  const cost = Array.from({ length: n + 1 }, (_, a) => Int32Array.from({ length: m + 1 }, (_, b) => (a === 0 ? b : b === 0 ? a : 0)));
  const sub = (a, b) => (keys[a] && keys[a] === heard[b].key ? 0 : 1);
  for (let a = 1; a <= n; a++) {
    for (let b = 1; b <= m; b++) cost[a][b] = Math.min(cost[a - 1][b - 1] + sub(a - 1, b - 1), cost[a - 1][b] + 1, cost[a][b - 1] + 1);
  }
  const at = new Array(n).fill(null);
  let matched = 0;
  for (let a = n, b = m; a > 0 && b > 0; ) {
    if (cost[a][b] === cost[a - 1][b - 1] + sub(a - 1, b - 1)) {
      at[a - 1] = heard[b - 1].start;
      if (!sub(a - 1, b - 1)) matched++;
      a--, b--;
    } else if (cost[a][b] === cost[a - 1][b] + 1) a--;
    else b--;
  }

  // Words that weren't heard go between their neighbours; punctuation gets no time.
  const spoken = keys.map((k, a) => (k ? a : -1)).filter((a) => a >= 0);
  const known = spoken.filter((a) => at[a] !== null);
  for (const a of spoken) {
    if (at[a] !== null) continue;
    const before = known.findLast((x) => x < a);
    const after = known.find((x) => x > a);
    if (before === undefined && after === undefined) at[a] = 0;
    else if (before === undefined) at[a] = at[after];
    else if (after === undefined) at[a] = at[before];
    else at[a] = at[before] + ((at[after] - at[before]) * (a - before)) / (after - before);
  }
  for (const a of keys.map((_, a) => a)) if (!keys[a]) at[a] = null;
  // Never going back in time
  let last = 0;
  const w = at.map((t) => (t === null ? null : (last = Math.max(last, Math.round(t * 100)))));
  const end = heard.findLast((h) => h.end != null)?.end ?? duration;
  return {
    ...fit(text, w, Math.max(last / 100, Math.min(end, duration)), sound),
    matched: spoken.length ? Math.round((matched / spoken.length) * 100) / 100 : 1,
  };
}

/**
 * Fits the times `w` (hundredths of a second) to where the sound is. Words Whisper
 * didn't hear at the start or end of an ayah share the time of the nearest one it
 * did; they're spread out, by length, between that word and where the sound starts
 * or stops. And the end is where the sound stops, if that's later: Whisper's end
 * for the last word is often early.
 * @param {number} heardEnd s
 * @param {{ start: number, end: number }} sound s
 */
function fit(text, w, heardEnd, sound) {
  const words = text.split(/\s+/).filter(Boolean);
  w = [...w];
  const spoken = w.map((t, a) => (t === null ? -1 : a)).filter((a) => a >= 0);
  const start = Math.round(sound.start * 100);
  const end = Math.round(sound.end * 100);
  const gap = SPREAD_OVER * 100;
  const spread = (indexes, from, to) => {
    const lengths = indexes.map((a) => words[a].length + 1);
    const total = lengths.reduce((x, y) => x + y, 0);
    let before = 0;
    indexes.forEach((a, k) => {
      w[a] = Math.round(from + ((to - from) * before) / total);
      before += lengths[k];
    });
  };
  if (spoken.length > 1) {
    // The first words: all but the last of those sharing the first time weren't heard.
    let run = 0;
    while (run + 1 < spoken.length && w[spoken[run + 1]] === w[spoken[0]]) run++;
    if (run > 0 && w[spoken[0]] - start > gap) spread(spoken.slice(0, run), start, w[spoken[0]]);
    // The last words: all but the first of those sharing the last time weren't heard.
    let back = spoken.length - 1;
    while (back > 0 && w[spoken[back - 1]] === w[spoken.at(-1)]) back--;
    if (back < spoken.length - 1 && end - w[spoken.at(-1)] > gap) spread(spoken.slice(back), w[spoken[back]], end);
  }
  const first = w.find((t) => t !== null) ?? start;
  const last = w.findLast((t) => t !== null) ?? 0;
  return { w, s: Math.min(start, first), e: Math.max(last, end, Math.round(heardEnd * 100)) };
}

/** Where the sound starts and stops, in seconds: the first and last 10 ms within about 30 dB of the loudest. */
function soundBounds(pcm) {
  const frame = 160; // 10 ms at 16 kHz
  const levels = [];
  for (let i = 0; i + frame <= pcm.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += pcm[j] * pcm[j];
    levels.push(Math.sqrt(sum / frame));
  }
  const loud = Math.max(...levels) * QUIET;
  const first = levels.findIndex((x) => x > loud);
  if (first < 0) return { start: 0, end: pcm.length / 16000 };
  return { start: first / 100, end: (levels.findLastIndex((x) => x > loud) + 1) / 100 };
}

// "[All]" → "all", "Ever-Living," → "everliving"
function key(word) {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// --- input ----------------------------------------------------------------------

async function loadText() {
  const file = dataPath('.cache', 'quran', 'en.sahih.json');
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    const surahs = await downloadEdition('en.sahih');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(surahs));
    return surahs;
  }
}

async function download(n) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(AUDIO.replace('{n}', n), { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 5) throw new Error(`couldn't download ayah ${n}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

function ref(i) {
  const s = surahStarts.findLastIndex((start) => start <= i);
  return `${s + 1}:${i - surahStarts[s] + 1}`;
}
