// Finds where in the Quran a transcribed snippet of recitation comes from.
// Text comes from alquran.cloud and quran.com (`downloadEdition`); the server
// and the phone app each keep their own copy of it, so they pass in how to load it.
import { translation as findTranslation } from '../public/js/translations.js';

const MATCH_EDITION = 'quran-simple-clean'; // plain spelling, closest to what speech-to-text writes
const TAJWEED_EDITION = 'quran-tajweed'; // tajweed rules marked inline, and the surah names
// The King Fahd Complex's (KFGQPC) text of the Madinah mushaf, which its font is
// made for. The tajweed edition's own spelling drops some long vowels (ٱلْأَخِرَةِ)
// and uses code points the font draws as placeholders (ٲ).
const DISPLAY_EDITION = 'qpc-hafs';
/** The editions the phone app comes with (app/build.mjs), so it works offline from the start: the text, and the default translation. */
export const BUNDLED_EDITIONS = [MATCH_EDITION, TAJWEED_EDITION, DISPLAY_EDITION, findTranslation('en').edition];

const MIN_WORDS = 3; // shorter transcripts are too ambiguous to place
// ...except just after `near`, where two words are plenty to go on. A slow reciter
// often gets only two or three words into a clip.
const MIN_WORDS_CLOSE = 2;
const CLOSE_AHEAD = 20;
const CANDIDATES = 8; // alignments to score in detail
const NEAR_BEHIND = 30; // words: how far back from the last position still counts as "continuing"
const NEAR_AHEAD = 400;
const NEAR_BONUS = 2.5; // enough to break a tie between identical passages
// Per word away from `near`, so of two identical passages that both continue from
// there (like Ar-Rahman's refrain), the closer one wins. At most 0.8, less than a word's worth.
const NEAR_DISTANCE_COST = 0.002;
const NEAR_CANDIDATES = 3; // extra alignments kept for the best regions that continue from `near`
// If a different passage scores within this of the best (about one word's worth),
// the snippet could be either: the phrase appears in more than one place.
const AMBIGUITY_MARGIN = 2;

/**
 * @param {(id: string) => Promise<Surah[]>} loadEdition one text edition of the
 *   whole Quran, e.g. `downloadEdition` plus a cache
 */
export function createQuran(loadEdition) {
  const edition = memoize(loadEdition);
  const index = memoize(async () => buildIndex(await edition(MATCH_EDITION)));
  return {
    /**
     * @param {string} transcript Arabic text from speech-to-text
     * @param {number | null} near word index of the last known position, to prefer continuing from there
     * @param {number | null} surah only look in this surah (1–114), or null for the whole Quran
     * @returns {Promise<null | { surah: number, ayah: number, word: number, ayahEnd: number, score: number,
     *   ambiguous: boolean, continues: boolean }>}
     *   `word` is the global word index where the snippet ends (pass it back as `near`), and
     *   `ayahEnd` the index of that ayah's last word: when they're equal, the reciter has just finished it.
     *   `ambiguous` means another passage fits about as well, so listen to more before trusting it.
     *   `continues` means it carries on from `near`.
     */
    locate: async (transcript, near = null, surah = null) => locate(await index(), transcript, near, surah),

    /** Every surah, for choosing one: { number, name, englishName, englishNameTranslation, revelationType, ayahs }, `ayahs` being how many. */
    listSurahs: async () =>
      (await edition(TAJWEED_EDITION)).map((s) => ({
        number: s.number,
        name: s.name,
        englishName: s.englishName,
        englishNameTranslation: s.englishNameTranslation,
        revelationType: s.revelationType,
        ayahs: s.ayahs.length,
      })),

    /**
     * A surah's verses for display, with an optional translation (a code from
     * public/js/translations.js, or 'none'). Without the internet the first time,
     * it comes without the translation, and `translationError` says why. Each verse's
     * `firstWord` is the global word index it starts at (same numbering as `locate`),
     * `words` how many words it has in that numbering, and its `segments` are
     * its text in pieces to colour (see `colourTajweed`).
     */
    getSurah: async (number, translation = 'en') => {
      const id = findTranslation(translation)?.edition;
      const [tajweed, display, trans, idx] = await Promise.all([
        edition(TAJWEED_EDITION),
        edition(DISPLAY_EDITION),
        id ? edition(id).catch((err) => err) : null,
        index(),
      ]);
      const failed = trans instanceof Error;
      const surah = surahView(number, tajweed, display, failed ? null : trans, idx);
      if (surah && failed) surah.translationError = trans.message;
      return surah;
    },

    /** Loads the text and builds the search index ahead of the first `locate`. */
    warmUp: () => index(),
  };
}

function locate(index, transcript, near, onlySurah = null) {
  const t = normalizeArabic(transcript);
  if (t.length < (near === null ? MIN_WORDS : MIN_WORDS_CLOSE)) return null;

  const range = onlySurah ? surahWords(index, onlySurah) : { from: 0, to: index.words.length };
  const continues = (end) => near !== null && end >= near - NEAR_BEHIND && end <= near + NEAR_AHEAD;
  const ranked = candidateRegions(index, t, near, range)
    .map((start) => align(index, t, Math.max(range.from, start - 3), Math.min(range.to, start + t.length + 3)))
    .filter(Boolean)
    .map((m) => ({ ...m, rank: m.score + (continues(m.end) ? NEAR_BONUS - NEAR_DISTANCE_COST * Math.abs(m.end - near) : 0) }))
    .sort((a, b) => b.rank - a.rank);
  const best = ranked[0];

  // Most of the transcript has to line up, or it's noise (or not the Quran).
  const close = (end) => near !== null && end >= near && end <= near + CLOSE_AHEAD;
  if (!best || best.matched < (close(best.end) ? MIN_WORDS_CLOSE : MIN_WORDS) || best.matched < t.length * 0.5) return null;
  // The Basmala on its own begins nearly every surah, so it says nothing about where we are.
  if (best.matchedWords.every((w) => index.basmala.has(w))) return null;

  const runnerUp = ranked.find((m) => Math.abs(m.end - best.end) > t.length);
  const ambiguous = Boolean(runnerUp) && best.rank - runnerUp.rank < AMBIGUITY_MARGIN;
  const ayahIndex = index.wordAyah[best.end];
  const [surah, ayah] = index.ayahRef[ayahIndex];
  return {
    surah,
    ayah,
    word: best.end,
    ayahEnd: (index.ayahFirstWord[ayahIndex + 1] ?? index.words.length) - 1,
    score: Math.round(best.score * 10) / 10,
    ambiguous,
    continues: continues(best.end),
  };
}

function surahView(number, tajweed, display, trans, index) {
  const s = tajweed[number - 1];
  if (!s) return null;
  return {
    number,
    name: s.name,
    englishName: s.englishName,
    englishNameTranslation: s.englishNameTranslation,
    revelationType: s.revelationType,
    // Shown above the first verse, as segments like a verse's. Al-Fatiha's is
    // its verse 1, and At-Tawbah has none.
    basmala: number !== 1 && number !== 9 ? colourTajweed(tajweed[0].ayahs[0], display[0].ayahs[0]).segments : null,
    verses: s.ayahs.map((marked, i) => {
      const ayah = index.surahFirstAyah[number - 1] + i;
      const firstWord = index.ayahFirstWord[ayah];
      return {
        number: i + 1,
        ...colourTajweed(marked, display[number - 1].ayahs[i]),
        translation: trans?.[number - 1].ayahs[i] ?? null,
        firstWord,
        words: (index.ayahFirstWord[ayah + 1] ?? index.words.length) - firstWord,
      };
    }),
  };
}

// --- index --------------------------------------------------------------------

/** The word indices [from, to) of a surah. */
function surahWords({ surahFirstAyah, ayahFirstWord, words }, surah) {
  const from = ayahFirstWord[surahFirstAyah[surah - 1]];
  const next = surahFirstAyah[surah];
  return { from, to: next === undefined ? words.length : ayahFirstWord[next] };
}

function buildIndex(surahs) {
  const words = []; // every word of the Quran, normalised
  const wordAyah = []; // word index → global ayah index
  const ayahRef = []; // global ayah index → [surah, ayah]
  const ayahFirstWord = []; // global ayah index → its first word index
  const surahFirstAyah = []; // surah number - 1 → global index of its first ayah
  for (const s of surahs) {
    surahFirstAyah.push(ayahRef.length);
    s.ayahs.forEach((text, i) => {
      ayahRef.push([s.number, i + 1]);
      ayahFirstWord.push(words.length);
      for (const w of normalizeArabic(i === 0 && s.number !== 1 ? stripBasmala(text) : text)) {
        words.push(w);
        wordAyah.push(ayahRef.length - 1);
      }
    });
  }
  const basmala = new Set(); // word indices that belong to a Basmala (1:1 and inside 27:30)
  for (let i = 0; i + 4 <= words.length; i++) {
    if (words.slice(i, i + 4).join(' ') === BASMALA) for (let k = i; k < i + 4; k++) basmala.add(k);
  }
  const positions = new Map();
  words.forEach((w, i) => {
    if (!positions.has(w)) positions.set(w, []);
    positions.get(w).push(i);
  });
  return { words, wordAyah, ayahRef, ayahFirstWord, surahFirstAyah, basmala, positions };
}

// Each word that matches exactly votes for where the transcript would start;
// rare words count for more. The busiest start positions are the candidates.
// Only words in `range` vote (all of them, unless it's looking in one surah).
function candidateRegions({ words, positions }, t, near, range) {
  const votes = new Map();
  t.forEach((w, j) => {
    const hits = positions.get(w);
    if (!hits) return;
    const weight = Math.log(words.length / hits.length);
    for (const p of hits) if (p >= range.from && p < range.to) votes.set(p - j, (votes.get(p - j) ?? 0) + weight);
  });

  // Recognition errors add or drop words, so pool votes over nearby starts.
  const pooled = [...votes.keys()].map((d) => {
    let sum = 0;
    for (let k = d - 3; k <= d + 3; k++) sum += votes.get(k) ?? 0;
    return [d, sum];
  });
  pooled.sort((a, b) => b[1] - a[1]);

  const regions = [];
  const add = (list, limit) => {
    let added = 0;
    for (const [d] of list) {
      if (added === limit) break;
      if (regions.every((r) => Math.abs(r - d) > t.length)) {
        regions.push(d);
        added++;
      }
    }
  };
  add(pooled, CANDIDATES);
  // A passage that's in many places (a refrain) can fill every slot with copies
  // from elsewhere, so also take the best ones that would continue from `near`,
  // the closest first.
  if (near !== null) {
    const end = (d) => d + t.length - 1;
    const nearby = pooled
      .filter(([d]) => end(d) >= near - NEAR_BEHIND && end(d) <= near + NEAR_AHEAD)
      .sort((a, b) => b[1] - a[1] || Math.abs(end(a[0]) - near) - Math.abs(end(b[0]) - near));
    add(nearby, NEAR_CANDIDATES);
  }
  return regions;
}

// Smith-Waterman local alignment of the transcript against words[from, to),
// with partial credit for near-miss spellings.
function align({ words }, t, from, to) {
  from = Math.max(0, from);
  to = Math.min(words.length, to);
  const m = t.length;
  const n = to - from;
  if (n <= 0) return null;

  const GAP = -0.8;
  const H = new Float64Array((m + 1) * (n + 1)); // 64-bit so the traceback's equality checks hold
  const at = (i, j) => i * (n + 1) + j;
  let bestScore = 0;
  let bestCell = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const h = Math.max(
        0,
        H[at(i - 1, j - 1)] + wordScore(t[i - 1], words[from + j - 1]),
        H[at(i - 1, j)] + GAP,
        H[at(i, j - 1)] + GAP,
      );
      H[at(i, j)] = h;
      if (h > bestScore) {
        bestScore = h;
        bestCell = at(i, j);
      }
    }
  }
  if (bestScore === 0) return null;

  // Walk back to collect which Quran words lined up.
  const matchedWords = [];
  let i = Math.floor(bestCell / (n + 1));
  let j = bestCell % (n + 1);
  while (i > 0 && j > 0 && H[at(i, j)] > 0) {
    const s = wordScore(t[i - 1], words[from + j - 1]);
    if (H[at(i, j)] === H[at(i - 1, j - 1)] + s) {
      if (s > 0) matchedWords.push(from + j - 1);
      i--;
      j--;
    } else if (H[at(i, j)] === H[at(i - 1, j)] + GAP) {
      i--;
    } else {
      j--;
    }
  }
  if (!matchedWords.length) return null;
  return { score: bestScore, matched: matchedWords.length, matchedWords, end: Math.max(...matchedWords) };
}

function wordScore(a, b) {
  if (a === b) return 2;
  const similarity = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return similarity >= 0.6 ? 2 * similarity - 0.4 : -1;
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// --- text ---------------------------------------------------------------------

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/** Arabic text → comparable words: no vowel marks, one spelling per letter family. */
export function normalizeArabic(text) {
  return text
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/[^ء-ي\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const BASMALA = 'بسم الله الرحمن الرحيم';

// alquran.cloud prefixes the first verse of each surah with the Basmala.
function stripBasmala(text) {
  const tokens = text.split(' ');
  return normalizeArabic(tokens.slice(0, 4).join(' ')).join(' ') === BASMALA ? tokens.slice(4).join(' ') : text;
}

// --- tajweed colours ----------------------------------------------------------

// The tajweed edition marks each rule inline, e.g. "أَحَ[q[د]ٌ" or "[h:12[ٱ]لْحَىُّ",
// sometimes one inside another. These are the rules a coloured mushaf shows, in
// the groups Malaysian mushafs colour them in; the rest stay uncoloured.
const TAJWEED_COLOURS = {
  o: 'madd', // mad wajib muttasil and mad jaiz munfasil: 4-5 counts
  m: 'madd', // mad lazim: 6 counts
  q: 'qalqalah',
  g: 'ghunnah', // nun and mim with shaddah
  a: 'ghunnah', // idgham with ghunnah
  f: 'ghunnah', // ikhfa'
  c: 'ghunnah', // ikhfa' shafawi
  i: 'ghunnah', // iqlab
  w: 'ghunnah', // idgham shafawi
};
const WAQF_SIGN = /[ۖ-ۜ]/; // ۖ ۗ ۘ ۙ ۚ ۛ, and ۜ for a saktah

/**
 * @param {string} marked a verse in the tajweed edition's markup
 * @param {string} [shown] the same verse as it should be shown (the KFGQPC's
 *   spelling): the rules are carried over to it. Without it, the tajweed
 *   edition's own text is shown.
 * @returns {{ text: string, segments: [string, string][] }} the plain text, and
 *   the same text in pieces of [text, colour]: 'madd', 'qalqalah', 'ghunnah',
 *   'ra' (a heavy ra), 'waqf' (a waqf sign) or '' (none)
 */
export function colourTajweed(marked, shown) {
  let text = '';
  let colours = [];
  const open = []; // the innermost rule applies
  for (const [token, rule] of marked.matchAll(/\[([a-z])(?::\d+)?\[|\]|[^[\]]+/g)) {
    if (rule) open.push(rule);
    else if (token === ']') open.pop();
    else {
      text += token;
      colours.push(...Array(token.length).fill(TAJWEED_COLOURS[open.at(-1)] ?? ''));
    }
  }
  if (shown !== undefined) {
    colours = carryOver(text, colours, shown);
    text = shown;
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] === 'ر' && isHeavyRa(text, i)) {
      // The letter even inside another rule (the ra of خَيْرًا كَثِيرًا is also
      // part of an ikhfa'); its vowel marks only if they have no colour yet, and
      // not the small alif of رَٰ, a long vowel of its own.
      colours[i] = 'ra';
      for (let k = i + 1; k < afterMarks(text, i) && text[k] !== 'ٰ'; k++) colours[k] ||= 'ra';
    }
    // The tajweed edition often leaves the maddah out of the long madd it marks.
    if (text[i] === 'ٓ' && colours[i - 1] === 'madd') colours[i] = 'madd';
    // ۜ is also the small sin on a sad read as sin (يَبۡصُۜطُ), inside a word.
    if (WAQF_SIGN.test(text[i]) && (text[i] !== 'ۜ' || !/\S/.test(text[afterMarks(text, i)] ?? ''))) {
      colours[i] = 'waqf';
    }
  }
  // Chrome paints a letter's marks in the letter's colour, so an uncoloured
  // letter takes the colour of a tanwin, small alif or maddah on it (لٗا, لَٰٓ).
  for (let i = 0; i < text.length; i++) {
    if (!colours[i] || !LETTER_COLOURING_MARK.test(text[i])) continue;
    const letter = letterBefore(text, i);
    if (colours[letter]) continue;
    for (let k = letter; k < afterMarks(text, letter); k++) colours[k] ||= colours[i];
  }

  const segments = [];
  for (let i = 0; i < text.length; i++) {
    const last = segments.at(-1);
    if (last?.[1] === colours[i]) last[0] += text[i];
    else segments.push([text[i], colours[i]]);
  }
  return { text, segments };
}

// Characters the two texts spell differently for the same thing, mapped to one of them.
const SAME_AS = {
  '\u0672': '\u0670', // small alif: ٲ → ٰ
  '\u06e1': '\u0652', // sukun: ۡ → ْ
  '\u06df': '\u0652', // the zeros over silent letters: ۟ ۠ → ْ
  '\u06e0': '\u0652',
  '\u0649': '\u064a', // ya, dotted or not: ى ٮ → ي
  '\u066e': '\u064a',
  '\u0657': '\u064b', // tanwin before idgham, ikhfa' or iqlab, written open: ٗ ٞ ٖ → ً ٌ ٍ
  '\u065e': '\u064c',
  '\u0656': '\u064d',
};
const same = (c) => SAME_AS[c] ?? c;

const WORD = /\S*[ء-يٱ-ۓ]\S*/g; // with the signs on it; not a waqf sign or ۞ on its own

/**
 * Gives each character of `to` the colour of the character of `from` it lines
 * up with: word by word when they have the same words (nearly always, and much
 * faster for long verses), otherwise the whole verse at once.
 */
function carryOver(from, colours, to) {
  const a = [...from.matchAll(WORD)];
  const b = [...to.matchAll(WORD)];
  if (a.length !== b.length) return alignLetters(from, colours, to);
  const result = Array(to.length).fill('');
  a.forEach((word, k) => {
    const carried = alignLetters(word[0], colours.slice(word.index, word.index + word[0].length), b[k][0]);
    result.splice(b[k].index, carried.length, ...carried);
  });
  return result;
}

/**
 * Lines two spellings up letter by letter (edit distance, where the spellings
 * above count as equal). A character only `to` has, like a maddah, takes the
 * colour of the character before it if it's a mark on it, and none otherwise.
 */
function alignLetters(from, colours, to) {
  const n = from.length;
  const m = to.length;
  const cost = new Uint16Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  const a = Array.from(from, same);
  const b = Array.from(to, same);
  const step = (i, j) => (a[i - 1] === b[j - 1] ? 0 : 1);
  for (let i = 0; i <= n; i++) cost[at(i, 0)] = i;
  for (let j = 0; j <= m; j++) cost[at(0, j)] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[at(i, j)] = Math.min(cost[at(i - 1, j - 1)] + step(i, j), cost[at(i - 1, j)] + 1, cost[at(i, j - 1)] + 1);
    }
  }
  const result = Array(m).fill(null);
  for (let i = n, j = m; j > 0; ) {
    if (i > 0 && cost[at(i, j)] === cost[at(i - 1, j - 1)] + step(i, j)) result[--j] = colours[--i];
    else if (i > 0 && cost[at(i, j)] === cost[at(i - 1, j)] + 1) i--;
    else j--;
  }
  for (let j = 0; j < m; j++) result[j] ??= j > 0 && MARK.test(to[j]) ? result[j - 1] : '';
  return result;
}

const MARK = /[ؐ-ًؚ-ٰٟۖ-ۭ]/; // vowels, shaddah, sukun and Quranic signs that sit on a letter
// Tanwin (also the open forms ٗ ٞ ٖ), the small alif and the maddah.
const LETTER_COLOURING_MARK = /[\u064b-\u064d\u0656\u0657\u065e\u0670\u0653]/;
const HEAVY_LETTERS = 'خصضغطقظ'; // huruf isti'la'

// Ra is heavy (tafkhim) with a fathah or dammah, and thin (tarqiq) with a kasrah.
// A ra with sukun takes after the letter before it: heavy after a fathah or
// dammah or a hamzat wasl (ٱرْجِعُوا), thin after a kasrah unless one of the
// heavy letters follows in the same word (قِرْطَاس).
function isHeavyRa(text, i) {
  const end = afterMarks(text, i);
  const marks = text.slice(i + 1, end);
  if (marks.includes('۪')) return false; // the imalah in مَجْر۪ٮٰهَا (11:41) is thin
  // The last letter of an ayah is read as you stop there, with a sukun, except
  // that a fathatan becomes a long a (ـرًا).
  const lastLetter = !/[ء-يٮ-ۓ]/.test(text.slice(end));
  const vowel = lastLetter && !/[\u064b\u0657]/.test(marks) ? '' : vowelOf(marks);
  if (vowel) return vowel !== 'i';

  let before = letterBefore(text, i);
  if (text[before] === 'ٱ') return true;
  let vowelBefore = vowelOf(text.slice(before + 1, afterMarks(text, before)));
  if (vowelBefore === 'i') return !lastLetter && HEAVY_LETTERS.includes(text[end]);
  if (vowelBefore) return true;
  // Only when stopping: a silent letter or long vowel comes between. After a ya
  // it's thin (خَيْر، قَدِير); otherwise it takes after the letter before that.
  if (/[يى]/.test(text[before])) return false;
  before = letterBefore(text, before);
  vowelBefore = vowelOf(text.slice(before + 1, afterMarks(text, before)));
  return vowelBefore !== 'i';
}

/** 'a', 'u' or 'i' for a fathah, dammah or kasrah (or their tanwin, also the open forms) among a letter's marks, '' for none */
function vowelOf(marks) {
  if (/[\u064e\u064b\u0657]/.test(marks)) return 'a';
  if (/[\u064f\u064c\u065e]/.test(marks)) return 'u';
  if (/[\u0650\u064d\u0656]/.test(marks)) return 'i';
  return '';
}

function afterMarks(text, i) {
  let j = i + 1;
  while (j < text.length && MARK.test(text[j])) j++;
  return j;
}

function letterBefore(text, i) {
  let j = i - 1;
  while (j > 0 && MARK.test(text[j])) j--;
  return j;
}

// --- data ---------------------------------------------------------------------

/**
 * @typedef {{ number: number, name: string, englishName: string, englishNameTranslation: string,
 *   revelationType: string, ayahs: string[] }} Surah
 */

/** @returns {Promise<Surah[]>} one edition (text or translation) of the whole Quran */
export async function downloadEdition(id) {
  if (id === DISPLAY_EDITION) return downloadKfgqpcText();
  const res = await fetch(`https://api.alquran.cloud/v1/quran/${id}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Couldn't download Quran text (${id}): HTTP ${res.status}`);
  return (await res.json()).data.surahs.map((s) => ({
    number: s.number,
    name: s.name,
    englishName: s.englishName,
    englishNameTranslation: s.englishNameTranslation,
    revelationType: s.revelationType,
    ayahs: s.ayahs.map((a) => a.text),
  }));
}

// The KFGQPC text comes from quran.com. Only the verses are kept (the surah names
// come from the tajweed edition), without the number each one ends in.
async function downloadKfgqpcText() {
  const res = await fetch('https://api.quran.com/api/v4/quran/verses/qpc_hafs', { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Couldn't download Quran text (${DISPLAY_EDITION}): HTTP ${res.status}`);
  const surahs = [];
  for (const { verse_key: key, text_qpc_hafs: text } of (await res.json()).verses) {
    const number = Number(key.split(':')[0]);
    surahs[number - 1] ??= { number, ayahs: [] };
    surahs[number - 1].ayahs.push(text.replace(/\s*[\u0660-\u0669]+$/, ''));
  }
  return surahs;
}

// Remembers each result; a failure is forgotten so the next call tries again.
function memoize(fn) {
  const results = new Map();
  return (key) => {
    if (!results.has(key)) {
      results.set(
        key,
        fn(key).catch((err) => {
          results.delete(key);
          throw err;
        }),
      );
    }
    return results.get(key);
  };
}
