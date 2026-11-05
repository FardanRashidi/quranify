// The offline voice: every surah, with its size, to save Ibrahim Walk's recording
// of it on the phone or delete it, and buttons for the short surahs (Juz ʿAmma)
// and the whole Quran at once. It opens over the settings panel, from the voice
// section, and closes back to it. saved-voice.js does the saving.
import * as saved from './saved-voice.js';
import { fetchSurahs } from './api.js';

const surahRange = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const JUZ_AMMA = surahRange(78, 114);
const ALL = surahRange(1, 114);

/** Bytes as MB, to a sensible precision: 0.4 MB, 2.5 MB, 49 MB. */
export function megabytes(bytes) {
  const mb = bytes / 1e6;
  return `${mb < 10 ? Math.max(0.1, Math.round(mb * 10) / 10) : Math.round(mb)} MB`;
}

export class SavedVoicePanel {
  #dialog;
  #summary;
  #juzAmma;
  #all;
  #stop;
  #deleteAll;
  #list;
  #rows = []; // { li, status, button }, by surah
  #names = null; // each surah's English name, once loaded
  #queued = false; // a render waiting for the next frame

  /** @param {HTMLDialogElement} dialog */
  constructor(dialog) {
    this.#dialog = dialog;
    const body = dialog.querySelector('.settings-body');
    const make = (tag, props) => Object.assign(document.createElement(tag), props);
    const intro = make('p', {
      className: 'note',
      textContent:
        'Save Ibrahim Walk’s recording on this phone, and the English translation is read aloud even without the internet. Most short surahs take less than 1 MB.',
    });
    this.#summary = make('p', { className: 'saved-summary' });
    this.#summary.setAttribute('role', 'status');
    const actions = make('div', { className: 'saved-actions' });
    this.#juzAmma = make('button', { type: 'button', className: 'primary' });
    this.#all = make('button', { type: 'button' });
    this.#stop = make('button', { type: 'button', textContent: 'Stop saving' });
    this.#deleteAll = confirmButton('Delete everything saved', 'Tap again to delete it all', () => saved.remove().catch((err) => console.warn(err)));
    actions.append(this.#juzAmma, this.#all, this.#stop, this.#deleteAll);
    const tip = make('p', { className: 'note', textContent: 'Saving a lot at once is best on Wi-Fi. It carries on while this is closed, but not once the app is.' });
    this.#list = make('ol', { className: 'saved-list' });
    body.append(intro, this.#summary, actions, tip, this.#list);

    this.#juzAmma.addEventListener('click', () => saved.save(JUZ_AMMA));
    this.#all.addEventListener('click', () => saved.save(ALL));
    this.#stop.addEventListener('click', () => saved.stop());
    this.#list.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-surah]');
      if (!button) return;
      const number = Number(button.dataset.surah);
      const { saved: count, total, job } = saved.surah(number);
      if (job) saved.stop(number);
      else if (count === total) saved.remove(number).catch((err) => console.warn(err));
      else saved.save([number]);
    });
    saved.onChange(() => this.open && this.#renderSoon());

    dialog.querySelector('.close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close(); // the backdrop
    });
    // A step in the history on top of the settings panel's, so Back closes just this.
    dialog.addEventListener('close', () => {
      if (history.state?.savedVoice) history.back();
    });
    addEventListener('popstate', () => {
      if (dialog.open && !history.state?.savedVoice) dialog.close();
    });
  }

  get open() {
    return this.#dialog.open;
  }

  async show() {
    if (this.open) return;
    history.pushState({ ...history.state, savedVoice: true }, '');
    this.#dialog.showModal();
    this.#summary.textContent = 'Loading…';
    try {
      const [surahs] = await Promise.all([fetchSurahs(), saved.load()]);
      this.#names ??= surahs.map((s) => s.englishName);
    } catch (err) {
      this.#summary.textContent = `Couldn’t load: ${err.message}`;
      return;
    }
    if (!this.#rows.length) this.#build();
    this.#render();
  }

  #build() {
    this.#rows = this.#names.map((name, i) => {
      const li = document.createElement('li');
      const span = (className, text) => Object.assign(document.createElement('span'), { className, textContent: text });
      const status = span('status', '');
      const button = Object.assign(document.createElement('button'), { type: 'button' });
      button.dataset.surah = i + 1;
      li.append(span('number', i + 1), span('english', name), status, button);
      this.#list.append(li);
      return { li, status, button, name };
    });
  }

  // Saving reports each ayah, so many changes can come in one frame.
  #renderSoon() {
    if (this.#queued) return;
    this.#queued = true;
    requestAnimationFrame(() => {
      this.#queued = false;
      if (this.open) this.#render();
    });
  }

  #render() {
    if (!saved.loaded() || !this.#rows.length) return;
    const { surahs, bytes, saving } = saved.summary();
    let error = '';
    this.#rows.forEach((row, i) => {
      const s = saved.surah(i + 1);
      const size = megabytes(s.bytes);
      const done = s.saved === s.total;
      row.li.classList.toggle('saved', done);
      if (s.job === 'saving') row.status.textContent = `Saving… ${Math.floor((s.saved / s.total) * 100)}%`;
      else if (s.job === 'waiting') row.status.textContent = `${size} · Waiting to save`;
      else if (done) row.status.textContent = `${size} · Saved ✓`;
      else if (s.error) row.status.textContent = s.error;
      else if (s.saved) row.status.textContent = `${size} · Partly saved (${s.saved} of ${s.total} ayahs)`;
      else row.status.textContent = size;
      error ||= s.error;
      row.button.textContent = s.job ? 'Stop' : done ? 'Delete' : 'Save';
      row.button.setAttribute('aria-label', `${row.button.textContent} ${row.name}`);
    });

    const parts = [];
    if (bytes) parts.push(`Saved on this phone: ${savedSurahs(surahs)} (${megabytes(bytes)})`);
    else parts.push('Nothing saved yet, so it plays from the internet.');
    if (saving) parts.push(`Saving ${saving} more…`);
    else if (error) parts.push(error);
    this.#summary.textContent = parts.join(' · ');

    const label = (button, text, numbers) => {
      const more = saved.sizeToSave(numbers);
      button.hidden = more < 1;
      button.textContent = `${text} (${megabytes(more)})`;
    };
    label(this.#juzAmma, 'Save Juz ʿAmma, surahs 78–114', JUZ_AMMA);
    label(this.#all, 'Save the whole Quran', ALL);
    this.#stop.hidden = !saving;
    this.#deleteAll.hidden = !bytes;
  }
}

/** "1 surah", "3 surahs", or (with only some of one saved) "part of a surah" */
export const savedSurahs = (count) => (count ? `${count} ${count === 1 ? 'surah' : 'surahs'}` : 'part of a surah');

// Asks twice, since there's no undo.
function confirmButton(text, again, action) {
  const button = Object.assign(document.createElement('button'), { type: 'button', textContent: text });
  let armed = false;
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = again;
      setTimeout(() => {
        armed = false;
        button.textContent = text;
      }, 4000);
      return;
    }
    armed = false;
    button.textContent = text;
    action();
  });
  return button;
}
