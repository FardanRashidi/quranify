// Reads an ayah's translation aloud: picks a voice for its language, says it a
// piece at a time, and reports each word as it's said, for highlighting.
import * as speech from './speech.js';
import * as settings from './settings.js';

// The languages each translation can be read in, best first. Malay voices are
// rare, and Indonesian is close enough to follow.
const LANGUAGES = { en: ['en-US', 'en'], ms: ['ms-MY', 'ms', 'id-ID', 'id'] };
const VOICE_SETTING = { en: 'voiceEn', ms: 'voiceMs' };
// Characters per piece at normal speed. Chrome stops some voices (Google's
// online ones) after about 15 s, and this is about 10 s of speech.
const PIECE = 160;

export const supported = speech.supported;

export class Reader {
  #speaking = false;
  #again = false;
  #generation = 0; // bumped by stop(), so a read that's still starting up knows to give up

  /** Whether something is being said right now. */
  get speaking() {
    return this.#speaking;
  }

  /**
   * Reads `text`, a translation in `language` ('en' or 'ms').
   * @param {(start: number, end: number) => void} [onWord] the word being said, as its place in `text`
   * @returns {Promise<boolean>} true once it's been read to the end, false if it was stopped
   */
  async read(text, language, onWord) {
    const generation = ++this.#generation;
    for (const [start, end] of pieces(text, PIECE * Math.min(1, settings.get('readingSpeed')))) {
      do {
        this.#again = false;
        const voice = await voiceFor(language);
        if (generation !== this.#generation) return false;
        this.#speaking = true;
        let done;
        try {
          done = await speech.speak(text.slice(start, end), {
            voice: voice?.id,
            lang: voice?.lang ?? LANGUAGES[language][0],
            rate: settings.get('readingSpeed'),
            onWord: (a, b) => onWord?.(start + a, start + b),
          });
        } finally {
          this.#speaking = false;
        }
        if (generation !== this.#generation) return false;
        if (!done && !this.#again) return false;
      } while (this.#again);
    }
    return true;
  }

  /** Says the current piece again, with the speed and voice as they are now. */
  again() {
    if (!this.#speaking) return;
    this.#again = true;
    speech.stop();
  }

  stop() {
    this.#generation++;
    this.#again = false;
    speech.stop();
  }
}

/** The voices that can read a translation, best first, as { id, name, lang }. */
export async function voicesFor(language) {
  const all = await speech.voices();
  return [...new Set(LANGUAGES[language].flatMap((tag) => all.filter((v) => sameLanguage(v.lang, tag))))];
}

/** The voice to use: the one chosen in the settings, else the device's own for the language, else the first. */
export async function voiceFor(language) {
  const chosen = settings.get(VOICE_SETTING[language]);
  const voices = await voicesFor(language);
  return voices.find((v) => v.id === chosen) ?? voices.find((v) => v.default) ?? voices[0] ?? null;
}

// 'en-US' only matches en-US; 'en' matches every English.
function sameLanguage(lang, tag) {
  const l = lang.replace('_', '-').toLowerCase();
  const t = tag.toLowerCase();
  return l === t || (!t.includes('-') && l.startsWith(`${t}-`));
}

/** Splits text into [start, end) pieces of at most `size` characters, at the end of a sentence where possible. */
function pieces(text, size) {
  const result = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const piece = text.slice(start, end);
      const at = lastBreak(piece, /[.!?;:]["'”’)\]]*\s/g) ?? lastBreak(piece, /[,—–]\s|\s[-–—]\s/g) ?? lastBreak(piece, /\s/g);
      if (at) end = start + at;
    }
    result.push([start, end]);
    start = end;
  }
  return result;
}

function lastBreak(text, pattern) {
  let at = null;
  for (const m of text.matchAll(pattern)) at = m.index + m[0].length;
  return at;
}
