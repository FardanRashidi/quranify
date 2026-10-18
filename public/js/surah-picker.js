// The list of surahs, for opening one by hand: to read it, have it read aloud,
// or have Listen look for the reciter in that surah only. A filter at the top
// matches the number, the English name or its meaning, or the Arabic name.
import * as api from './api.js';

export class SurahPicker {
  /** Called with the chosen surah's number. */
  onPick = null;

  #dialog;
  #list;
  #filter;
  #surahs = null; // promise of the list, loaded the first time it opens
  #current = null; // the surah on screen, marked in the list

  /** @param {HTMLDialogElement} dialog */
  constructor(dialog) {
    this.#dialog = dialog;
    this.#list = dialog.querySelector('.surah-list');
    this.#filter = dialog.querySelector('.surah-filter');
    this.#filter.addEventListener('input', () => this.#render());
    // Enter opens the first one left
    this.#filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.#list.querySelector('button')?.click();
    });
    this.#list.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-surah]');
      if (!button) return;
      dialog.close();
      this.onPick?.(Number(button.dataset.surah));
    });
    dialog.querySelector('.close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close(); // the backdrop
    });
    // Like the settings panel: Back closes it rather than leaving the page.
    dialog.addEventListener('close', () => {
      if (history.state?.surahs) history.back();
    });
    addEventListener('popstate', () => {
      if (dialog.open) dialog.close();
    });
  }

  get open() {
    return this.#dialog.open;
  }

  /** @param {number | null} current the surah on screen, if any */
  async show(current) {
    if (this.open) return;
    this.#current = current;
    this.#filter.value = '';
    history.pushState({ surahs: true }, '');
    this.#dialog.showModal();
    // Typing straight away on a computer; on a phone the keyboard would cover the list.
    if (matchMedia('(pointer: fine)').matches) this.#filter.focus();
    else this.#filter.blur();
    if (!this.#surahs) {
      this.#list.replaceChildren(note('loading…'));
      this.#surahs = api.fetchSurahs().catch((err) => {
        this.#surahs = null;
        throw err;
      });
    }
    try {
      await this.#surahs;
    } catch (err) {
      this.#list.replaceChildren(note(`couldn't load the surahs: ${err.message}`));
      return;
    }
    this.#render();
    this.#list.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' });
  }

  async #render() {
    const surahs = await this.#surahs;
    const latin = simplify(this.#filter.value);
    const arabic = plainArabic(this.#filter.value);
    const shown = surahs.filter(
      (s) =>
        (!latin && !arabic) ||
        (latin && (String(s.number) === latin || simplify(s.englishName).includes(latin) || simplify(s.englishNameTranslation).includes(latin))) ||
        (arabic && plainArabic(s.name).includes(arabic)),
    );
    this.#list.replaceChildren(...(shown.length ? shown.map((s) => this.#item(s)) : [note('no surah by that name')]));
  }

  #item(s) {
    const li = document.createElement('li');
    const button = Object.assign(document.createElement('button'), { type: 'button' });
    button.dataset.surah = s.number;
    if (s.number === this.#current) button.setAttribute('aria-current', 'true');
    const span = (className, text) => Object.assign(document.createElement('span'), { className, textContent: text });
    button.append(
      span('number', s.number),
      span('english', s.englishName),
      span('arabic', s.name.replace(/^سُورَةُ /, '')), // without "surah", as the English names are
      span('meaning', `${s.englishNameTranslation} · ${s.ayahs} ayahs`),
    );
    li.append(button);
    return li;
  }
}

// "Al-Faatiha" and "al faatiha" and "alfaatiha" all match.
const simplify = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

// Arabic letters only, without the vowel marks, and each kind of alif as a plain one: "يس" finds "سُورَةُ يسٓ".
const plainArabic = (text) =>
  text
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/[^\u0621-\u064a]/g, '');

function note(text) {
  return Object.assign(document.createElement('li'), { className: 'note', textContent: text });
}
