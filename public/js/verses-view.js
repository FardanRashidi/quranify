// Renders a surah's verses and keeps the current one highlighted and centred.
const USER_SCROLL_PAUSE = 4000; // ms to stop auto-scrolling after the user scrolls

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// The word being read aloud, marked without touching the text (where the browser can).
const spoken = globalThis.Highlight && CSS.highlights ? new Highlight() : null;
if (spoken) CSS.highlights.set('spoken', spoken);

export class VersesView {
  #el;
  #lines = [];
  #current = -1;
  #reading = -1;
  #userScrollUntil = 0;
  /** Called with a verse's index when the user taps it. */
  onSelect = null;
  /** Whether moves made by following or reading aloud scroll the verse into view. */
  follow = true;
  /** Whether scrolling is animated (unless the device asks for reduced motion). */
  smooth = true;

  constructor(el) {
    this.#el = el;
    const pause = () => (this.#userScrollUntil = performance.now() + USER_SCROLL_PAUSE);
    el.addEventListener('wheel', pause, { passive: true });
    el.addEventListener('touchmove', pause, { passive: true });
    el.addEventListener('click', (e) => {
      if (!getSelection().isCollapsed) return; // selecting text to copy, not tapping
      const index = this.#lines.indexOf(e.target.closest('.verse'));
      if (index >= 0) this.onSelect?.(index);
    });
    // Keep the current verse centred when the view changes size (e.g. a phone rotates).
    new ResizeObserver(() => {
      if (this.#current >= 0) this.#scrollTo(this.#lines[this.#current], 'instant');
    }).observe(el);
  }

  message(text) {
    this.#setLines([]);
    this.#el.append(paragraph('message', text));
  }

  /**
   * @param {{ basmala: Segment[] | null, verses: { number: number, segments: Segment[], translation: string | null }[] }} surah
   * @param {HTMLElement | null} [header] shown above the surah
   */
  showVerses({ basmala, verses }, header = null) {
    this.#setLines(
      verses.map((v) => {
        const block = document.createElement('div');
        block.className = 'verse';
        const arabic = arabicParagraph('arabic', [...v.segments, [' ', '']]);
        // In the KFGQPC font, Arabic-Indic digits come out as the mushaf's end-of-ayah sign.
        arabic.append(Object.assign(document.createElement('span'), {
          className: 'ayah-number',
          textContent: v.number.toLocaleString('ar-EG'),
        }));
        block.append(arabic);
        if (v.translation) block.append(paragraph('translation', v.translation));
        return block;
      }),
    );
    if (basmala) this.#el.prepend(arabicParagraph('basmala', basmala));
    if (header) this.#el.prepend(header);
  }

  /**
   * @param {'follow' | boolean} scroll 'follow' scrolls unless the user just
   *   scrolled away themselves (or turned it off); true always scrolls (they asked for this verse).
   */
  setCurrent(index, scroll = 'follow') {
    if (index === this.#current || index >= this.#lines.length) return;
    const firstJump = this.#current === -1;
    this.#current = index;
    this.#lines.forEach((line, i) => {
      line.classList.toggle('past', i < index);
      line.classList.toggle('current', i === index);
    });
    if (index < 0 || !scroll || (scroll === 'follow' && !this.follow)) return;
    if (scroll === true) this.#userScrollUntil = 0;
    this.#scrollTo(this.#lines[index], firstJump || !this.smooth || reducedMotion.matches ? 'instant' : 'smooth');
  }

  /** Marks the verse whose translation is being read aloud, or none (-1). */
  setReading(index) {
    if (index === this.#reading) return;
    this.#lines[this.#reading]?.classList.remove('reading');
    this.#lines[index]?.classList.add('reading');
    this.#reading = index;
    spoken?.clear();
  }

  /** Marks the word being read aloud: characters [start, end) of the verse's translation. */
  markWord(start, end) {
    const text = this.#lines[this.#reading]?.querySelector('.translation')?.firstChild;
    if (!spoken || !text) return;
    const range = new Range();
    range.setStart(text, Math.min(start, text.length));
    range.setEnd(text, Math.min(end, text.length));
    spoken.clear();
    spoken.add(range);
    // A long verse's translation runs past the fade at the bottom: keep the word in sight.
    if (!this.follow || performance.now() < this.#userScrollUntil) return;
    const word = range.getBoundingClientRect();
    const view = this.#el.getBoundingClientRect();
    if (word.bottom > view.bottom - view.height * 0.2 || word.top < view.top + view.height * 0.15) {
      this.#el.scrollBy({ top: word.top - view.top - view.height * 0.4, behavior: this.smooth && !reducedMotion.matches ? 'smooth' : 'instant' });
    }
  }

  #setLines(elements) {
    this.#el.replaceChildren(...elements);
    this.#lines = elements;
    this.#current = this.#reading = -1;
    spoken?.clear();
    this.#el.scrollTop = 0;
  }

  #scrollTo(line, behavior) {
    if (performance.now() < this.#userScrollUntil) return;
    const view = this.#el.clientHeight;
    // Centre the verse, unless it's too tall to fit (a long one); then show its start.
    const top =
      line.offsetHeight > view * 0.7 ? line.offsetTop - view * 0.15 : line.offsetTop - view / 2 + line.offsetHeight / 2;
    this.#el.scrollTo({ top, behavior });
  }
}

function paragraph(className, text) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

/**
 * @typedef {[text: string, colour: string]} Segment a piece of a verse and its
 *   tajweed colour ('madd', 'qalqalah', 'ghunnah', 'ra', 'waqf' or '' for none)
 */
export function arabicParagraph(className, segments) {
  const p = document.createElement('p');
  p.className = className;
  p.dir = 'rtl';
  p.lang = 'ar';
  for (const [text, colour] of segments) {
    p.append(colour ? Object.assign(document.createElement('span'), { className: `tj-${colour}`, textContent: text }) : text);
  }
  return p;
}
