// The list of surahs, for opening one by hand: to read it, have it read aloud,
// or have Listen look for the reciter in that surah only. A filter at the top
// matches the number, the English name or its meaning, or the Arabic name.
// A second tab lists the 30 juz, to do the same with a juz: its filter matches
// the juz's number, its first words, or a surah in it.
// In the app, a third tab lists the surahs auto search has heard.
import * as api from './api.js';

export class SurahPicker {
  /** Called with the chosen surah's number, and the ayah to open it at. */
  onPick = null;
  /** Called with the chosen juz, as api.fetchJuz() lists it. */
  onPickJuz = null;

  #dialog;
  #list;
  #filter;
  #tabs;
  #tab = 'all'; // all | juz | heard
  #browse = 'all'; // the list it opens on: all | juz, whichever was looked in last
  #surahs = null; // promise of the list, loaded the first time it opens
  #juz = null; // promise of the juz, loaded the first time their tab opens
  #current = null; // where the reader is, { surah, ayah }, marked in the lists

  /** @param {HTMLDialogElement} dialog */
  constructor(dialog) {
    this.#dialog = dialog;
    this.#list = dialog.querySelector('.surah-list');
    this.#filter = dialog.querySelector('.surah-filter');
    this.#tabs = dialog.querySelector('.tabs');
    this.#tabs.querySelector('[data-tab="heard"]').hidden = !api.autoSearch.supported;
    this.#tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (!tab || tab === this.#tab) return;
      this.#filter.value = ''; // what it's typed means something else there
      this.#show(tab);
    });
    this.#filter.addEventListener('input', () => this.#render());
    // Enter opens the first one left
    this.#filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.#list.querySelector('button')?.click();
    });
    this.#list.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-surah], button[data-juz]');
      if (!button) return;
      dialog.close();
      const juz = Number(button.dataset.juz);
      if (juz) this.#juz.then((list) => this.onPickJuz?.(list[juz - 1]));
      else this.onPick?.(Number(button.dataset.surah), Number(button.dataset.ayah ?? 1));
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
   * @param {{ surah: number, ayah: number } | null} current where the reader is, if there's a surah on screen
   * @param {'all' | 'juz' | 'heard'} [tab] the heard tab, in the app, lists what auto search has heard.
   *   Without one, it's the list looked in last: the surahs, or the juz.
   */
  async show(current, tab = this.#browse) {
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
    if (tab !== 'heard') this.#browse = tab;
    this.#list.parentElement.scrollTop = 0;
    for (const button of this.#tabs.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    this.#filter.hidden = tab === 'heard';
    this.#filter.placeholder = tab === 'juz' ? 'Juz number, or a surah in it' : 'Name, meaning or number';
    this.#filter.setAttribute('aria-label', tab === 'juz' ? 'Find a juz' : 'Find a surah');
    // Typing straight away on a computer; on a phone the keyboard would cover the list.
    if (tab !== 'heard' && matchMedia('(pointer: fine)').matches) this.#filter.focus();
    else this.#filter.blur();
    if (!this.#surahs || (tab === 'juz' && !this.#juz)) this.#list.replaceChildren(note('Loading…'));
    // The juz are described by the surahs they span, so every tab needs the surahs.
    this.#surahs ??= retryable(api.fetchSurahs(), () => (this.#surahs = null));
    if (tab === 'juz') this.#juz ??= retryable(api.fetchJuz(), () => (this.#juz = null));
    try {
      await Promise.all([this.#surahs, tab === 'juz' && this.#juz]);
    } catch (err) {
      if (this.#tab === tab) this.#list.replaceChildren(note(`Couldn’t load the ${tab === 'juz' ? 'juz' : 'surahs'}: ${err.message}`));
      return;
    }
    if (this.#tab !== tab) return; // switched to another meanwhile
    if (tab === 'heard') return this.#renderHeard();
    await this.#render();
    this.#list.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' });
  }

  #render() {
    return this.#tab === 'juz' ? this.#renderJuz() : this.#renderSurahs();
  }

  async #renderSurahs() {
    const surahs = await this.#surahs;
    const latin = simplify(this.#filter.value);
    const arabic = plainArabic(this.#filter.value);
    const shown = surahs.filter((s) => (!latin && !arabic) || isSurah(s, latin, arabic, true));
    this.#list.replaceChildren(...(shown.length ? shown.map((s) => this.#item(s, `${s.englishNameTranslation} · ${s.ayahs} ayahs`)) : [note('No surah by that name')]));
  }

  // The 30 juz: each one's first words, and the surahs and ayahs it runs from and to.
  async #renderJuz() {
    const [surahs, juz] = await Promise.all([this.#surahs, this.#juz]);
    const latin = simplify(this.#filter.value);
    const arabic = plainArabic(this.#filter.value);
    const spans = (j) => surahs.slice(j.start.surah - 1, j.end.surah);
    const shown = juz.filter(
      (j) =>
        (!latin && !arabic) ||
        (latin && String(j.number) === latin) ||
        (arabic && plainArabic(j.opening).includes(arabic)) ||
        spans(j).some((s) => isSurah(s, latin, arabic, false)),
    );
    // "Al-Baqara 253", kept on one line: a long range wraps at the dash, not inside "Aal-i-Imraan"
    const place = (n, ayah) => Object.assign(document.createElement('span'), { className: 'place', textContent: `${surahs[n - 1]?.englishName ?? `Surah ${n}`} ${ayah}` });
    const at = this.#current && [this.#current.surah, this.#current.ayah ?? 1];
    const items = shown.map((j) => {
      const { start, end } = j;
      const range = start.surah === end.surah ? [place(start.surah, `${start.ayah}–${end.ayah}`)] : [place(start.surah, start.ayah), ' – ', place(end.surah, end.ayah)];
      const here = Boolean(at) && !before(at, [start.surah, start.ayah]) && !before([end.surah, end.ayah], at);
      const li = this.#row(j.number, `Juz ${j.number}`, j.opening, range, here);
      li.querySelector('button').dataset.juz = j.number;
      return li;
    });
    this.#list.replaceChildren(...(items.length ? items : [note('No juz by that number, or with that surah in it')]));
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
    // The Arabic name without "surah", as the English names are
    const li = this.#row(s.number, s.englishName, s.name.replace(/^سُورَةُ /, ''), about, s.number === this.#current?.surah);
    li.querySelector('button').dataset.surah = s.number;
    return li;
  }

  /**
   * A button in the list: a number, a name in English and in Arabic, and a line about it
   * (text, or what to put in it). `current`: where the reader is.
   */
  #row(number, english, arabic, about, current) {
    const li = document.createElement('li');
    const button = Object.assign(document.createElement('button'), { type: 'button' });
    if (current) button.setAttribute('aria-current', 'true');
    const span = (className, ...content) => {
      const el = Object.assign(document.createElement('span'), { className });
      el.append(...content);
      return el;
    };
    button.append(span('number', number), span('english', english), span('arabic', arabic), span('meaning', ...[about].flat()));
    li.append(button);
    return li;
  }
}

// "Al-Faatiha" and "al faatiha" and "alfaatiha" all match.
const simplify = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

// Whether surah `s` is what's been typed: its English name or meaning, its Arabic name, or (with `number`) its number.
const isSurah = (s, latin, arabic, number) =>
  Boolean(latin && ((number && String(s.number) === latin) || simplify(s.englishName).includes(latin) || simplify(s.englishNameTranslation).includes(latin))) ||
  Boolean(arabic && plainArabic(s.name).includes(arabic));

// Whether [surah, ayah] `a` comes before `b`
const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

// A list being loaded: if it fails, `forget` clears it, so the next time it opens tries again.
function retryable(promise, forget) {
  return promise.catch((err) => {
    forget();
    throw err;
  });
}

// Arabic letters only, without the vowel marks: "يس" finds "سُورَةُ يسٓ". Without any
// alif either, since the mushaf writes some as a small one over the letter (in the vowel
// marks' range): "تبارك" finds "تَبَٰرَكَ".
const plainArabic = (text) =>
  text
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0627\u0671]/g, '')
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
