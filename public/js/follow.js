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
// How many words the reciter said in a stretch of reciting: at their pace, with this much leeway.
const SAY = 1.3;
const SAY_WORDS = 3;
// A pause means the end of the ayah if, at this many times their pace, the reciter
// would have got to its last word by now. Other pauses (a breath partway) are left to the next check.
const NEAR_END = 2;
// And it's taken as the end without waiting for the check if, at their pace, they'd have got there.
const EXPECT_END = 1;
// Checks can't keep up with ayahs that are over before the next check comes round,
// so through those it moves on by the reciter's pace, without hearing each one end:
// ayahs that take up to this many times the time from one check to the next. Tried on
// At-Takwir's short ayahs with checks taking 2 s, the right ayah was on screen 68% of
// the time instead of 51% (Alafasy), and 90% instead of 85% (Husary); Al-Mulk's
// longer ayahs were unchanged.
const SHORT_AYAH = 1.5;
const RECKON_FOR = 6; // seconds: how far past the last check it goes by pace alone

export class Follower {
  /** The reciter's pace, in words per second (pauses included). */
  pace = START_PACE;
  /** The ayah on screen: { surah, ayah }, or null until the reciter's place is found. */
  at = null;
  #heard = null; // { word, at }: the last word heard, and when (the clip's end, in ms)
  #anticipated = null; // { surah, ayah }: moved on to at a pause, before a check heard the last one end

  get found() {
    return this.#heard !== null;
  }

  /** The global index of the last word heard (pass it to locate() as `near`), or null. */
  get word() {
    return this.#heard?.word ?? null;
  }

  /** { word, at }: the last word heard, and when (performance.now() at the clip's end), or null. */
  get heard() {
    return this.#heard && { ...this.#heard };
  }

  /** How many words the reciter could have got through in this many seconds (generously: at twice their pace). */
  reachIn(seconds) {
    return REACH_WORDS + REACH * this.pace * seconds;
  }

  /** At most how many words the reciter said in this many seconds of reciting (at their pace, with some leeway). */
  saidIn(seconds) {
    return SAY_WORDS + SAY * this.pace * Math.max(0, seconds);
  }

  reset() {
    this.pace = START_PACE;
    this.at = this.#heard = this.#anticipated = null;
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
    // stays in the surah: the app stops at its last ayah). Having moved on at a pause,
    // a check that's missed the last word or so of the ayah before doesn't move back.
    const anticipated = this.#anticipated;
    this.#anticipated = null;
    const ahead = anticipated?.surah === match.surah && anticipated.ayah === match.ayah + 1;
    const finished = match.word === match.ayahEnd || (ahead && match.ayahEnd - match.word <= LAST_WORD);
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

  /**
   * At a pause: moves on to the next ayah if, at the pace they've been going, the
   * reciter would have finished the one on screen when the sound stopped. The next
   * check confirms it, or puts them back for a breath partway through.
   * @param {number} stoppedAt performance.now() when the sound stopped
   * @param {{ firstWord: number, words: number } | undefined} verse the ayah on screen, once its surah has loaded
   * @param {number} ayahs how many the surah has: it doesn't go past the last
   * @returns {null | { surah: number, ayah: number }} where to go, or null to stay
   */
  anticipate(stoppedAt, verse, ayahs) {
    if (!this.#heard || !verse || this.#anticipated || this.at.ayah >= ayahs) return null;
    const wordsLeft = verse.firstWord + verse.words - 1 - this.#heard.word;
    if (wordsLeft > EXPECT_END * this.pace * Math.max(0, (stoppedAt - this.#heard.at) / 1000)) return null;
    this.at = { surah: this.at.surah, ayah: this.at.ayah + 1 };
    this.#anticipated = this.at;
    return this.at;
  }

  /**
   * The ayah to show the reciter on now: the one they're on, or past each short
   * ayah whose last word they'd have said by now at their pace (see SHORT_AYAH).
   * It stops at a longer one, which waits for a check or a pause.
   * @param {number} now performance.now()
   * @param {{ firstWord: number, words: number }[] | undefined} verses their surah's, once it's loaded
   * @param {number} turnaround seconds from one check to the next: how long one takes, plus the shortest wait
   * @returns {number | null} null before they're found
   */
  reckon(now, verses, turnaround) {
    if (!this.#heard || !verses) return this.at?.ayah ?? null;
    const said = this.#heard.word + this.pace * clamp((now - this.#heard.at) / 1000, 0, RECKON_FOR);
    let ayah = this.at.ayah;
    while (ayah < verses.length) {
      const verse = verses[ayah - 1];
      if (verse.words / this.pace > SHORT_AYAH * turnaround || said < verse.firstWord + verse.words - 1) break;
      ayah++;
    }
    return ayah;
  }

  #withinReach(match, at) {
    if (!this.#heard) return true;
    const seconds = Math.max(0, (at - this.#heard.at) / 1000);
    const words = match.word - this.#heard.word;
    return words >= 0 && words <= this.reachIn(seconds);
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
