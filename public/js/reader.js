// Reads an ayah's translation aloud: picks a voice for its language, says it a
// piece at a time, and reports each word as it's said, for highlighting. English
// can also be the recording of Ibrahim Walk reading it (recording.js), the default.
import * as speech from './speech.js';
import * as recording from './recording.js';
import * as settings from './settings.js';
import { translation } from './translations.js';

// The languages a translation can be read in, best first, as voices name them
const tags = (language) => translation(language)?.speech ?? [language];
// Characters per piece at normal speed. Chrome stops some voices (Google's
// online ones) after about 15 s, and this is about 10 s of speech.
const PIECE = 160;
const MAX_BOOSTED = 2; // catching up never reads faster than this, unless the speed setting already is
/** The voice setting's value for the recording, rather than one of the device's voices. */
export const RECORDED = 'ibrahim-walk';

/** Whether this browser can read anything aloud. */
export const supported = speech.supported || recording.supported;

let deviceVoices = null; // the device's voices, once listed

/**
 * Whether it can read a translation (a code from translations.js): the recording
 * is English only, and otherwise the device needs a voice for the language.
 * Until the voices have been listed (see `refreshVoices`), it might.
 */
export const supportedFor = (language) =>
  (language === 'en' && recording.supported) ||
  (speech.supported && (deviceVoices === null || deviceVoices.some((v) => tags(language).some((tag) => sameLanguage(v.lang, tag)))));

/** Lists the device's voices again, for `supportedFor`. They can change while the app's away. */
export async function refreshVoices() {
  deviceVoices = await speech.voices();
}

const recorded = (language) => language === 'en' && recording.supported && settings.get('voice-en') === RECORDED;

export class Reader {
  #speaking = false;
  #playing = false; // the recording, rather than a device voice
  #again = false;
  #generation = 0; // bumped by stop(), so a read that's still starting up knows to give up
  #boost = 1;

  /** Whether something is being said right now. */
  get speaking() {
    return this.#speaking;
  }

  /**
   * How much faster than the speed setting to read, to catch up with a reciter
   * (1: no faster). The recording changes speed straight away, a device's
   * voice from its next piece.
   */
  set boost(value) {
    if (value === this.#boost) return;
    this.#boost = value;
    if (this.#playing) recording.setRate(this.#rate());
  }

  #rate() {
    const speed = settings.get('readingSpeed');
    return Math.min(speed * this.#boost, Math.max(speed, MAX_BOOSTED));
  }

  /**
   * Reads `text`, a translation in `language` (a code from translations.js).
   * @param {(start: number, end: number) => void} [onWord] the word being said, as its place in `text`
   * @param {{ surah: number, ayah: number }} [place] which ayah it is, for the recording
   * @returns {Promise<boolean>} true once it's been read to the end, false if it was stopped
   */
  async read(text, language, onWord, place) {
    const generation = ++this.#generation;
    let playable = Boolean(place); // the recording can read it, until it fails to
    for (;;) {
      this.#again = false;
      const result =
        playable && recorded(language)
          ? await this.#play(place, text, onWord)
          : await this.#say(text, language, onWord, generation, () => playable && recorded(language));
      if (generation !== this.#generation) return false;
      if (result === null) playable = false; // the recording couldn't be played (offline?): a device voice reads this one
      else if (!this.#again) return result;
      // Otherwise the voice was changed: read it again in the new one.
    }
  }

  /** The recording: true once it's played to the end, false if stopped, null if it couldn't be played. */
  async #play(place, text, onWord) {
    this.#speaking = this.#playing = true;
    try {
      return await recording.play(place, text, { rate: this.#rate(), onWord });
    } finally {
      this.#speaking = this.#playing = false;
    }
  }

  /** A device's voice, a piece at a time. Gives up, leaving #again set, if the recording is chosen while it reads. */
  async #say(text, language, onWord, generation, toRecording) {
    if (!speech.supported) throw new Error('the recording couldn’t be played');
    for (const [start, end] of pieces(text, PIECE * Math.min(1, this.#rate()))) {
      do {
        this.#again = false;
        const voice = await voiceFor(language);
        if (generation !== this.#generation) return false;
        this.#speaking = true;
        let done;
        try {
          done = await speech.speak(text.slice(start, end), {
            voice: voice?.id,
            lang: voice?.lang ?? tags(language)[0],
            rate: this.#rate(),
            onWord: (a, b) => onWord?.(start + a, start + b),
          });
        } finally {
          this.#speaking = false;
        }
        if (generation !== this.#generation) return false;
        if (this.#again && toRecording()) return false;
        if (!done && !this.#again) return false;
      } while (this.#again);
    }
    return true;
  }

  /** Says the current piece again, with the speed and voice as they are now. */
  again() {
    if (!this.#speaking) return;
    // The recording just changes speed; it doesn't need to start again.
    if (this.#playing && recorded('en')) return recording.setRate(this.#rate());
    this.#again = true;
    if (this.#playing) recording.stop();
    else speech.stop();
  }

  stop() {
    this.#generation++;
    this.#again = false;
    speech.stop();
    recording.stop();
  }
}

/** The voices that can read a translation, best first, as { id, name, lang }. */
export async function voicesFor(language) {
  const all = (deviceVoices = await speech.voices());
  return [...new Set(tags(language).flatMap((tag) => all.filter((v) => sameLanguage(v.lang, tag))))];
}

/** The voice to use: the one chosen in the settings, else the device's own for the language, else the first. */
export async function voiceFor(language) {
  const chosen = settings.get(`voice-${language}`);
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
      // Sentence ends, then clauses, then spaces. 。！？؟؛। and ，、، end them with no space after (Chinese, Japanese, Arabic script, Hindi).
      const at =
        lastBreak(piece, /[.!?;:]["'”’)\]]*\s|[。！？؟؛।]/g) ?? lastBreak(piece, /[,—–]\s|\s[-–—]\s|[，、،]/g) ?? lastBreak(piece, /\s/g);
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
