// The list of surahs, for opening one by hand: to read it, have it read aloud,
// or have Listen look for the reciter in that surah only. A filter at the top
// matches the number, the English name or its meaning, or the Arabic name.
// In the app, a second tab lists the surahs auto search has heard.
import * as api from './api.js';

export class SurahPicker {
  /** Called with the chosen surah's number, and the ayah to open it at. */
  onPick = null;

  #dialog;
  #list;
  #filter;
  #tabs;
  #tab = 'all'; // all | heard
  #surahs = null; // promise of the list, loaded the first time it opens
  #current = null; // the surah on screen, marked in the list

  /** @param {HTMLDialogElement} dialog */
  constructor(dialog) {
    this.#dialog = dialog;
    this.#list = dialog.querySelector('.surah-list');
    this.#filter = dialog.querySelector('.surah-filter');
    this.#tabs = dialog.querySelector('.tabs');
    this.#tabs.hidden = !api.autoSearch.supported;
    this.#tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (tab && tab !== this.#tab) this.#show(tab);
    });
    this.#filter.addEventListener('input', () => this.#render());
    // Enter opens the first one left
    this.#filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.#list.querySelector('button')?.click();
    });
    this.#list.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-surah]');
      if (!button) return;
      dialog.close();
      this.onPick?.(Number(button.dataset.surah), Number(button.dataset.ayah ?? 1));
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

  /**
   * @param {number | null} current the surah on screen, if any
   * @param {'all' | 'heard'} [tab] the heard tab, in the app, lists what auto search has heard
   */
  async show(current, tab = 'all') {
    if (this.open) return;
    // Opened from the settings panel, which goes Back as it closes: wait for
    // that, or it would take this step out of the history instead.
    if (history.state?.settings) {
      await new Promise((resolve) => {
        addEventListener('popstate', resolve, { once: true });
        setTimeout(resolve, 500);
      });
    }
    this.#current = current;
    this.#filter.value = '';
    history.pushState({ surahs: true }, '');
    this.#dialog.showModal();
    this.#show(tab);
  }

  async #show(tab) {
    this.#tab = tab;
    this.#list.parentElement.scrollTop = 0;
    for (const button of this.#tabs.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    this.#filter.hidden = tab !== 'all';
    // Typing straight away on a computer; on a phone the keyboard would cover the list.
    if (tab === 'all' && matchMedia('(pointer: fine)').matches) this.#filter.focus();
    else this.#filter.blur();
    if (!this.#surahs) {
      this.#list.replaceChildren(note('Loading…'));
      this.#surahs = api.fetchSurahs().catch((err) => {
        this.#surahs = null;
        throw err;
      });
    }
    try {
      await this.#surahs;
    } catch (err) {
      this.#list.replaceChildren(note(`Couldn’t load the surahs: ${err.message}`));
      return;
    }
    if (tab === 'heard') return this.#renderHeard();
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
    this.#list.replaceChildren(...(shown.length ? shown.map((s) => this.#item(s, `${s.englishNameTranslation} · ${s.ayahs} ayahs`)) : [note('No surah by that name')]));
  }

  // What auto search has heard, newest first, under the day it heard it.
  async #renderHeard() {
    const surahs = await this.#surahs;
    let entries = [];
    try {
      entries = await api.autoSearch.history();
    } catch (err) {
      console.warn(err);
    }
    if (this.#tab !== 'heard') return; // switched back meanwhile
    if (!entries.length) {
      this.#list.replaceChildren(note('Nothing yet. Turn on auto search in Settings, and each surah it hears is listed here.'));
      return;
    }
    const items = [];
    let lastDay = '';
    for (const { surah, from, to, start } of entries) {
      const s = surahs[surah - 1];
      if (!s) continue;
      if (dayName(start) !== lastDay) {
        lastDay = dayName(start);
        items.push(Object.assign(document.createElement('li'), { className: 'day', textContent: lastDay }));
      }
      const ayahs = from === to ? `Ayah ${from}` : `Ayahs ${from}–${to}`;
      const item = this.#item(s, `${ayahs} · ${new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
      item.querySelector('button').dataset.ayah = from;
      items.push(item);
    }
    items.push(clearButton(() => this.#renderHeard()));
    this.#list.replaceChildren(...items);
  }

  /** A surah's button: its number and names, and a line about it. */
  #item(s, about) {
    const li = document.createElement('li');
    const button = Object.assign(document.createElement('button'), { type: 'button' });
    button.dataset.surah = s.number;
    if (s.number === this.#current) button.setAttribute('aria-current', 'true');
    const span = (className, text) => Object.assign(document.createElement('span'), { className, textContent: text });
    button.append(
      span('number', s.number),
      span('english', s.englishName),
      span('arabic', s.name.replace(/^سُورَةُ /, '')), // without "surah", as the English names are
      span('meaning', about),
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

// "Today", "Yesterday", or the date
function dayName(ms) {
  const day = new Date(ms).toDateString();
  if (day === new Date().toDateString()) return 'Today';
  if (day === new Date(Date.now() - 864e5).toDateString()) return 'Yesterday';
  return new Date(ms).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

// Asks twice, since there's no undo.
function clearButton(cleared) {
  const li = Object.assign(document.createElement('li'), { className: 'clear' });
  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'clear-history', textContent: 'Clear the history' });
  let armed = false;
  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      button.textContent = 'Tap again to clear it';
      setTimeout(() => {
        armed = false;
        button.textContent = 'Clear the history';
      }, 4000);
      return;
    }
    await api.autoSearch.clearHistory().catch((err) => console.warn(err));
    cleared();
  });
  li.append(button);
  return li;
}

function note(text) {
  return Object.assign(document.createElement('li'), { className: 'note', textContent: text });
}
