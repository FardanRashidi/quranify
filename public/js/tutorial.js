// The tour: a few steps, each lighting up one part of the page and saying what
// it's for. It opens by itself the first time the app loads, and from the
// settings' "tutorial" row after that.
import { autoSearch } from './api.js';

const SEEN_KEY = 'tutorialSeen';
const PAD = 6; // around the lit-up part
const GAP = 12; // between it and the card
const MARGIN = 16; // keeps the card off the screen's edges

/** Each step: what it lights up (nothing: the card sits in the middle), and what it says. */
const STEPS = [
  {
    title: 'Quran Whisperer',
    text: 'It listens to a recitation, finds the surah and ayah, follows the reciter, and reads the translation aloud. Here’s a quick look at the buttons.',
  },
  {
    target: '#listen',
    title: 'listen',
    text: 'Press it and play a recitation, or recite yourself. It finds the ayah, then follows the reciter and reads the translation aloud. Press it again to stop. The first time, it asks to use the microphone.',
  },
  {
    target: '#status',
    title: 'status',
    text: 'What it’s doing: loading the speech model, listening, following, or why it hasn’t found the ayah yet. The dot at the top pulses while it searches and stays lit while it follows.',
  },
  {
    target: '#open-surahs',
    title: 'surahs',
    text: 'Choose a surah to read it. Listen then looks for the reciter in that surah only, which is quicker. With a surah open, the speaker button reads its translation aloud.',
  },
  {
    target: '#ayah-controls',
    title: 'ayah',
    text: 'The ayah you’re on. − and + move back and forward, or tap a verse. If it loses the reciter, or you lose your place, sync listens again.',
  },
  {
    target: '#verse-options',
    title: 'translation and tajweed',
    text: 'The translation under each verse, which is the one read aloud. Tajweed colours the letters by their rules, and a key above each surah explains the colours and the stop signs.',
  },
  {
    target: '#open-settings',
    title: 'settings',
    text: () =>
      `Choose what Listen does once it finds the ayah, the reading voice, colours and text sizes${
        autoSearch.supported ? ', and auto search, which listens in the background and sends a notification for each surah it hears' : ''
      }. This tour is there too.`,
  },
];

export class Tutorial {
  #dialog;
  #spot;
  #card;
  #count;
  #title;
  #text;
  #skip;
  #back;
  #next;
  #steps = [];
  #index = 0;

  /** @param {HTMLDialogElement} dialog */
  constructor(dialog) {
    this.#dialog = dialog;
    const make = (tag, props) => Object.assign(document.createElement(tag), props);
    this.#spot = make('div', { className: 'spot' });
    this.#count = make('p', { className: 'count' });
    this.#title = make('h2', { id: 'tutorial-title' });
    this.#text = make('p', { className: 'text' });
    this.#text.setAttribute('aria-live', 'polite');
    this.#skip = make('button', { type: 'button', className: 'skip', textContent: 'skip' });
    this.#back = make('button', { type: 'button', textContent: 'back' });
    this.#next = make('button', { type: 'button', className: 'primary' });
    const actions = make('div', { className: 'actions' });
    actions.append(this.#skip, this.#back, this.#next);
    this.#card = make('div', { className: 'card' });
    this.#card.append(this.#count, this.#title, this.#text, actions);
    dialog.append(this.#spot, this.#card);

    this.#skip.addEventListener('click', () => dialog.close());
    this.#back.addEventListener('click', () => this.#go(this.#index - 1));
    this.#next.addEventListener('click', () => (this.#index < this.#steps.length - 1 ? this.#go(this.#index + 1) : dialog.close()));
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.#next.click();
      else if (e.key === 'ArrowLeft' && this.#index > 0) this.#back.click();
    });
    // Like the settings panel: Back closes it rather than leaving the page.
    dialog.addEventListener('close', () => {
      try {
        localStorage.setItem(SEEN_KEY, '1');
      } catch {}
      if (history.state?.tutorial) history.back();
    });
    addEventListener('popstate', () => {
      if (dialog.open) dialog.close();
    });
    addEventListener('resize', () => this.open && this.#place());
    document.fonts?.ready.then(() => this.open && this.#place()); // the buttons change size as the font arrives
  }

  get open() {
    return this.#dialog.open;
  }

  /** It's been shown here before (or can't remember: then it doesn't keep opening). */
  get seen() {
    try {
      return localStorage.getItem(SEEN_KEY) !== null;
    } catch {
      return true;
    }
  }

  async show() {
    if (this.open) return;
    // Started from the settings panel, which goes Back as it closes: wait for
    // that, or it would take this step out of the history instead.
    if (history.state?.settings) {
      await new Promise((resolve) => {
        addEventListener('popstate', resolve, { once: true });
        setTimeout(resolve, 500);
      });
    }
    this.#steps = STEPS.filter(({ target }) => !target || document.querySelector(target)?.getClientRects().length);
    history.pushState({ tutorial: true }, '');
    this.#dialog.showModal();
    this.#go(0);
  }

  #go(index) {
    this.#index = index;
    const step = this.#steps[index];
    const last = index === this.#steps.length - 1;
    this.#count.textContent = `${index + 1} / ${this.#steps.length}`;
    this.#title.textContent = step.title;
    this.#text.textContent = typeof step.text === 'function' ? step.text() : step.text;
    this.#skip.hidden = last;
    this.#back.hidden = index === 0;
    this.#next.textContent = last ? 'done' : 'next';
    this.#place();
    this.#next.focus();
  }

  // Lights up the step's part of the page, and puts the card beside it: below,
  // or above when there's no room (the footer's controls).
  #place() {
    const target = this.#steps[this.#index].target;
    const card = this.#card.getBoundingClientRect();
    const box = target ? document.querySelector(target).getBoundingClientRect() : null;
    let top = (innerHeight - card.height) / 2;
    let left = (innerWidth - card.width) / 2;
    if (box) {
      const below = box.bottom + PAD + GAP;
      top = below + card.height <= innerHeight - MARGIN ? below : box.top - PAD - GAP - card.height;
      left = box.left + box.width / 2 - card.width / 2;
    }
    Object.assign(this.#card.style, {
      top: `${clamp(top, MARGIN, innerHeight - MARGIN - card.height)}px`,
      left: `${clamp(left, MARGIN, innerWidth - MARGIN - card.width)}px`,
    });
    // Without a part to light up, the spot shrinks to nothing in the middle and only its shade shows.
    this.#spot.classList.toggle('none', !box);
    Object.assign(this.#spot.style, {
      top: `${box ? box.top - PAD : innerHeight / 2}px`,
      left: `${box ? box.left - PAD : innerWidth / 2}px`,
      width: `${box ? box.width + 2 * PAD : 0}px`,
      height: `${box ? box.height + 2 * PAD : 0}px`,
    });
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
