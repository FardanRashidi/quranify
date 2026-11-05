// Following a recitation as it goes: where the reciter is, and when to check
// again. Each check costs a transcription, so they're timed by when the reciter
// should reach the end of the ayah on screen, at the pace they've been going:
// every couple of seconds through short ayahs, up to every 5 s early in a long one.

const SEARCH_EVERY = 1; // seconds between checks until the reciter's place is found
const START_PACE = 0.8; // words per second, until the reciter's own is known
const PACE_MEMORY = 15; // seconds: older stretches count for less and less
const MIN_PACE = 0.2;
const MAX_PACE = 3;
// Words past the ayah's last one to wait for: the speech model only writes a
// word once it's heard all of it.
const LAST_WORD = 1;
// How far on a passage that's in more than one place (a refrain) can be, to be
// taken as the reciter's: twice as far as their pace would take them, plus a few
// words. (A copy behind them is taken for one further on, so it's not believed either.)
const REACH = 2;
const REACH_WORDS = 6;
// A pause means the end of the ayah if, at this many times their pace, the reciter
// would have got to its last word by now. Other pauses (a breath partway) are left to the next check.
const NEAR_END = 2;

export class Follower {
  /** The reciter's pace, in words per second (pauses included). */
  pace = START_PACE;
  /** The ayah on screen: { surah, ayah }, or null until the reciter's place is found. */
  at = null;
  #heard = null; // { word, at }: the last word heard, and when (the clip's end, in ms)

  get found() {
    return this.#heard !== null;
  }

  /** The global index of the last word heard (pass it to locate() as `near`), or null. */
  get word() {
    return this.#heard?.word ?? null;
  }

  reset() {
    this.pace = START_PACE;
    this.at = this.#heard = null;
  }

  /**
   * Takes a check's answer.
   * @param {null | { surah, ayah, word, ayahEnd, ambiguous, continues }} match from locate()
   * @param {number} at performance.now() when the clip ended
   * @returns {null | { surah: number, ayah: number, unsure: boolean }} where to go, or null to stay
   */
  take(match, at) {
    if (!match) return null;
    if (match.ambiguous && !(match.continues && this.#withinReach(match, at))) {
      // A phrase that's in more than one place. Before the reciter is found, show
      // the best guess (unsure); after, it's more likely a repeat than a jump.
      return this.#heard ? null : { surah: match.surah, ayah: match.ayah, unsure: true };
    }
    if (this.#heard && match.continues) {
      const words = match.word - this.#heard.word;
      const seconds = (at - this.#heard.at) / 1000;
      if (words >= 0 && seconds > 0) {
        const weight = 1 - Math.exp(-seconds / PACE_MEMORY);
        this.pace = clamp(this.pace + weight * (words / seconds - this.pace), MIN_PACE, MAX_PACE);
      }
    }
    this.#heard = { word: match.word, at };
    // Having just finished an ayah, the reciter carries on with the next (this
    // stays in the surah: the app stops at its last ayah).
    const finished = match.word === match.ayahEnd;
    this.at = { surah: match.surah, ayah: finished ? match.ayah + 1 : match.ayah };
    return { ...this.at, unsure: false };
  }

  /**
   * Whether the reciter could have reached the end of the ayah on screen by now,
   * even if they're faster than they've been so far.
   * @param {number} now performance.now()
   * @param {{ firstWord: number, words: number } | undefined} verse the ayah on screen, once its surah has loaded
   */
  nearEnd(now, verse) {
    if (!this.#heard || !verse) return true;
    const wordsLeft = verse.firstWord + verse.words - 1 - this.#heard.word;
    return wordsLeft <= LAST_WORD + NEAR_END * this.pace * Math.max(0, (now - this.#heard.at) / 1000);
  }

  #withinReach(match, at) {
    if (!this.#heard) return true;
    const seconds = Math.max(0, (at - this.#heard.at) / 1000);
    const words = match.word - this.#heard.word;
    return words >= 0 && words <= REACH_WORDS + REACH * this.pace * seconds;
  }

  /**
   * Seconds to wait before the next check.
   * @param {number} now performance.now()
   * @param {{ firstWord: number, words: number } | undefined} verse the ayah on screen, once its surah has loaded
   * @param {{ min: number, max: number }} wait
   */
  delay(now, verse, { min, max }) {
    if (!this.#heard) return SEARCH_EVERY;
    if (!verse) return min;
    const wordsLeft = verse.firstWord + verse.words - 1 - this.#heard.word;
    return clamp((wordsLeft + LAST_WORD) / this.pace - (now - this.#heard.at) / 1000, min, max);
  }
}

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);
