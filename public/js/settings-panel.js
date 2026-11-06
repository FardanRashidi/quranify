// The settings panel: a dialog with a control for every setting in settings.js.
// The controls follow the settings, so a change made elsewhere (like the
// tutorial's text size) shows here too.
import * as settings from './settings.js';
import { arabicParagraph } from './verses-view.js';
import * as speech from './speech.js';
import { supported as canReadAloud, supportedFor, voiceFor, voicesFor, RECORDED } from './reader.js';
import * as recording from './recording.js';
import * as saved from './saved-voice.js';
import { SavedVoicePanel, megabytes, savedSurahs } from './saved-voice-panel.js';
import { autoSearch, fetchSurah } from './api.js';
import { TRANSLATIONS, translation } from './translations.js';
import { PREFERRED_MICROPHONE } from './listener.js';

// 51:21, "And in yourselves. Then will you not see?": short, with all five colours.
const PREVIEW = [
  ['وَف', ''],
  ['ِيٓ', 'madd'],
  [' أَ', ''],
  ['نف', 'ghunnah'],
  ['ُسِكُمۡ', ''],
  ['ۚ', 'waqf'],
  [' أَفَلَا تُ', ''],
  ['بۡ', 'qalqalah'],
  ['صِ', ''],
  ['رُ', 'ra'],
  ['ونَ ', ''],
];

// What the voice's "try" button says: 1:1 in the translation. Other languages
// take it from the translation itself, which is downloaded by then.
const SAMPLE = {
  en: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
  ms: 'Dengan nama Allah, Yang Maha Pemurah, lagi Maha Mengasihani.',
};
const sample = async (language) => SAMPLE[language] ?? (await fetchSurah(1, language).catch(() => null))?.verses[0].translation;

const GITHUB = 'https://github.com/FardanRashidi';
const NAME = 'Quran Whisperer';

// Where the text, the translation shown, the voice and the model come from, as
// their terms ask (Tanzil's: name it and link to tanzil.net). Links are [text, href].
function credits() {
  const shown = translation(settings.get('translation'));
  return [
    'Quran text from ',
    ['Tanzil', 'https://tanzil.net'],
    ' and the King Fahd Complex (KFGQPC), whose font this is. ',
    ...(shown ? [`Translation (${shown.name}): ${shown.translator ?? 'translator not named'}, through `, ['alquran.cloud', 'https://alquran.cloud'], '. '] : []),
    'Recorded English voice: Ibrahim Walk. Speech model: Tarteel’s whisper-base-ar-quran (Apache-2.0).',
  ];
}

const percent = (value) => `${value}%`;
const seconds = (value) => `${value} s`;
// 45 s, 1 min, 1 min 30 s
const duration = (value) => (value < 60 ? `${value} s` : `${Math.floor(value / 60)} min${value % 60 ? ` ${value % 60} s` : ''}`);
// Give up after: closer together where a few seconds matter, up to 10 minutes (a whole prayer, pauses and all)
const GIVE_UP = [20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600];
const NEXT_LISTEN = 'Takes effect the next time you press Listen';
const tajweedOn = () => settings.get('tajweed');
const translatedTo = (language) => settings.get('translation') === language;
// The translation shown can be read aloud: there's one, and a voice for it
const readable = () => canReadAloud && !translatedTo('none') && supportedFor(settings.get('translation'));
// The translation shown can't be read aloud: there's no voice for it on this device
const noVoice = () => canReadAloud && !translatedTo('none') && !supportedFor(settings.get('translation'));
// Ibrahim Walk's recording is the voice
const recordedVoice = () => translatedTo('en') && recording.supported && settings.get('voice-en') === RECORDED;

/**
 * Each section's rows. `when` hides a row (or leaves out a section) that doesn't
 * apply here, and `enabledWhen` greys out one that does nothing with the current
 * settings. `about` is a line under the section's title, and a `collapsed` section
 * stays folded away until it's opened.
 */
const SECTIONS = [
  {
    title: 'Text',
    rows: [
      { key: 'textSize', label: 'Text size', type: 'choice', options: settings.TEXT_SIZES, hint: 'For everything: the verses, buttons and menus' },
      { type: 'preview' },
      { key: 'arabicSize', label: 'Arabic size', type: 'range', min: 70, max: 200, step: 5, format: percent },
    ],
  },
  {
    title: 'Translation and voice',
    about: 'The translation under each ayah, and reading it aloud',
    rows: [
      {
        key: 'translation',
        label: 'Translation',
        type: 'select',
        options: [...TRANSLATIONS.map(({ code, name }) => [code, name]), ['none', 'None']],
        hint: 'Downloaded the first time you choose it',
      },
      {
        key: 'translationSize',
        label: 'Translation size',
        type: 'range',
        min: 70,
        max: 200,
        step: 5,
        format: percent,
        enabledWhen: () => !translatedTo('none'),
      },
      // For the translation shown
      {
        label: 'Voice',
        type: 'voice',
        when: readable,
        hint: () =>
          recordedVoice()
            ? `A recording of this translation (Saheeh International)${saved.supported ? '' : ', played from the internet'}`
            : '',
      },
      {
        label: 'Save the voice for offline',
        type: 'savedVoice',
        hint: savedVoiceHint,
        when: () => saved.supported && recordedVoice(),
      },
      {
        type: 'note',
        text: () => `This device has no voice for ${translation(settings.get('translation'))?.name}, so it can’t be read aloud. You can add one in the device’s text-to-speech settings`,
        when: () => !speech.installVoices && noVoice(),
      },
      {
        label: 'Voice',
        type: 'installVoices',
        hint: () => `This phone has no ${translation(settings.get('translation'))?.name} voice yet, so it can’t be read aloud. Download one, then come back`,
        when: () => Boolean(speech.installVoices) && noVoice(),
      },
      {
        key: 'readingSpeed',
        label: 'Reading speed',
        type: 'range',
        min: 0.5,
        max: 2,
        step: 0.05,
        format: (value) => `${value}×`,
        when: () => canReadAloud,
        enabledWhen: readable,
      },
      {
        key: 'listenRead',
        label: 'Read aloud when Listen finds the ayah',
        type: 'toggle',
        hint: 'Along with the reciter when following, otherwise on through the surah',
        when: () => canReadAloud,
        enabledWhen: readable,
      },
      {
        key: 'readEveryAyah',
        label: 'Read every ayah',
        type: 'toggle',
        hint: 'While following: each ayah in turn, faster (up to 1.5×) when the reciter gets ahead. Off: it skips to the ayah the reciter is on',
        when: () => canReadAloud,
        enabledWhen: readable,
      },
      {
        key: 'listenWhileReading',
        label: 'Keep listening while reading',
        type: 'toggle',
        hint: 'For headphones. Otherwise checks wait while it reads, so the microphone doesn’t hear the voice',
        when: () => canReadAloud,
        enabledWhen: readable,
      },
      { type: 'note', text: 'This browser can’t read aloud', when: () => !canReadAloud },
    ],
  },
  {
    title: 'Listening',
    about: 'What Listen does once it’s found the ayah, and how long it keeps trying',
    rows: [
      {
        key: 'listenFollow',
        label: 'Follow the reciter',
        type: 'toggle',
        hint: 'Once it finds the ayah, keep listening and move along with them. Off: stop listening once it’s found',
      },
      { key: 'followScroll', label: 'Scroll along', type: 'toggle', hint: 'To each ayah as following or reading aloud reaches it' },
      {
        key: 'giveUpAfter',
        label: 'Give up after',
        type: 'range',
        values: GIVE_UP,
        format: duration,
        hint: 'Of not hearing the ayah. Longer suits following a whole prayer, with its pauses',
      },
      {
        key: 'source',
        label: 'Audio source',
        type: 'choice',
        options: [['mic', 'Microphone'], ['tab', 'Tab / system']],
        hint: NEXT_LISTEN,
        when: () => Boolean(navigator.mediaDevices?.getDisplayMedia),
      },
      { key: 'microphone', label: 'Microphone', type: 'microphone', hint: NEXT_LISTEN },
    ],
  },
  {
    title: 'Appearance',
    rows: [
      { key: 'theme', label: 'Theme', type: 'choice', options: [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']], hint: 'Auto follows the device' },
      { key: 'accent', label: 'Accent colour', type: 'colour', themeVar: '--theme-accent' },
      { key: 'meter', label: 'Level meter', type: 'toggle', hint: 'On the Listen button, while it listens' },
      { key: 'animations', label: 'Animations', type: 'toggle', hint: 'Pulsing dot, smooth scrolling' },
    ],
  },
  {
    title: 'Tajweed',
    rows: [
      { key: 'tajweed', label: 'Tajweed colours', type: 'toggle' },
      { key: 'tajweedKey', label: 'Key above each surah', type: 'toggle', enabledWhen: tajweedOn },
      { key: 'tj-madd', label: 'Long, 4–6 counts', type: 'rule', enabledWhen: tajweedOn },
      { key: 'tj-qalqalah', label: 'Qalqalah', type: 'rule', enabledWhen: tajweedOn },
      { key: 'tj-ghunnah', label: 'Nasal (ghunnah)', type: 'rule', enabledWhen: tajweedOn },
      { key: 'tj-ra', label: 'Heavy ra', type: 'rule', enabledWhen: tajweedOn },
      { key: 'tj-waqf', label: 'Waqf signs', type: 'rule', enabledWhen: tajweedOn },
    ],
  },
  {
    title: 'Auto search',
    when: () => autoSearch.supported,
    rows: [
      { type: 'autoSearch', label: 'Listen in the background', hint: 'With the screen off too, and send a notification for each surah it hears' },
      { type: 'tile', label: 'Quick Settings tile', hint: 'Turns it on and off from the top of the screen. You can also add it by editing Quick Settings' },
      { type: 'history', label: 'History', hint: 'Each surah it’s heard, under Surahs → Heard' },
    ],
  },
  {
    title: 'Advanced',
    about: 'How often it checks while following, and how much it hears each time. The defaults suit most recitations',
    collapsed: true,
    rows: [
      {
        key: 'followMin',
        label: 'Shortest wait between checks',
        type: 'range',
        min: 1,
        max: 5,
        step: 0.5,
        format: seconds,
        hint: 'Through short ayahs, and near the end of a long one. A pause from the reciter there gets a check straight away',
      },
      { key: 'followMax', label: 'Longest wait between checks', type: 'range', min: 2, max: 15, step: 1, format: seconds, hint: 'Early in a long ayah' },
      { key: 'clipSeconds', label: 'Audio per check', type: 'range', min: 5, max: 12, step: 1, format: seconds, hint: 'More is surer, less is quicker' },
    ],
  },
  {
    title: 'About',
    rows: [
      { type: 'tutorial', label: 'Tutorial', hint: 'A quick tour of the buttons' },
      { type: 'link', label: 'Made by FardanRashidi', hint: 'On GitHub', href: GITHUB, text: 'GitHub ↗' },
      { type: 'credits' },
    ],
  },
];

// What's saved for offline, under its row: until it's been asked, what the row is for.
function savedVoiceHint() {
  if (!saved.loaded()) return 'Keep it on this phone, to hear it without the internet';
  const { surahs, bytes, saving } = saved.summary();
  const what = bytes ? `${savedSurahs(surahs)} saved (${megabytes(bytes)})` : 'Nothing saved yet, so it plays from the internet';
  return saving ? `${what} · saving ${saving} more…` : what;
}

let uid = 0;

export class SettingsPanel {
  /** Called when the tutorial row's button is pressed. The panel closes itself. */
  onTutorial = null;
  /** Called when the history row's button is pressed. The panel closes itself. */
  onHistory = null;

  #dialog;
  #rows = []; // { row, update() }
  #refreshing = false; // a refresh waiting for the next frame

  /** @param {HTMLDialogElement} dialog */
  constructor(dialog) {
    this.#dialog = dialog;
    const body = dialog.querySelector('.settings-body');
    for (const { title, about, rows, when, collapsed } of SECTIONS) {
      if (when && !when()) continue;
      const heading = Object.assign(document.createElement('h3'), { textContent: title });
      // Folded away: a <details>, with the heading as what opens it
      const section = document.createElement(collapsed ? 'details' : 'section');
      if (collapsed) {
        const summary = document.createElement('summary');
        summary.append(heading);
        section.append(summary);
      } else section.append(heading);
      if (about) section.append(Object.assign(document.createElement('p'), { className: 'about', textContent: about }));
      for (const spec of rows) {
        const built = build(spec);
        this.#rows.push({ ...built, spec });
        section.append(built.row);
      }
      body.append(section);
    }
    // A second close at the bottom, so there's no scrolling back up to the ×
    const done = Object.assign(document.createElement('button'), { type: 'button', className: 'close-bottom primary', textContent: 'Close' });
    body.append(resetButton(), done, versionLine());

    // The offline voice opens over this panel, and closes back to it.
    const savedVoicePanel = saved.supported ? new SavedVoicePanel(document.getElementById('saved-voice')) : null;
    dialog.addEventListener('saved-voice', () => savedVoicePanel?.show());
    // Saving reports each ayah: keep the row's summary up to date, once a frame at most.
    saved.onChange(() => {
      if (!this.open || this.#refreshing) return;
      this.#refreshing = true;
      requestAnimationFrame(() => {
        this.#refreshing = false;
        this.refresh();
      });
    });

    for (const close of dialog.querySelectorAll('.close, .close-bottom')) close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('tutorial', () => {
      dialog.close();
      this.onTutorial?.();
    });
    dialog.addEventListener('history', () => {
      dialog.close();
      this.onHistory?.();
    });
    // A click on the backdrop lands on the dialog itself.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    // Open, the panel is a step in the history, so Back (in the browser, or the
    // phone's back button in the app) closes it rather than leaving the page.
    dialog.addEventListener('close', () => {
      if (history.state?.settings) history.back();
    });
    // (Back from the offline voice, over this, leaves this open.)
    addEventListener('popstate', () => {
      if (dialog.open && !history.state?.settings) dialog.close();
    });
    settings.onChange((key) => {
      if (key === 'translation' && this.open) this.#listVoices();
      this.refresh();
    });
    // back from installing a voice
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.open && this.#listVoices());
  }

  get open() {
    return this.#dialog.open;
  }

  show() {
    if (this.open) return;
    history.pushState({ settings: true }, '');
    this.refresh();
    this.#dialog.showModal();
    listMicrophones(this.#rows.find((r) => r.spec.type === 'microphone'));
    this.#listVoices();
    if (saved.supported) saved.load().then(() => this.refresh(), (err) => console.warn(err));
  }

  #listVoices() {
    for (const row of this.#rows) if (row.spec.type === 'voice') listVoices(row);
  }

  /** Brings every control up to date (also after the theme changes by itself). */
  refresh() {
    for (const { row, spec, update } of this.#rows) {
      if (spec.when) row.hidden = !spec.when();
      row.inert = spec.enabledWhen ? !spec.enabledWhen() : false;
      update?.();
    }
  }
}

function build(spec) {
  if (spec.type === 'preview') {
    const row = arabicParagraph('preview', PREVIEW);
    row.append(Object.assign(document.createElement('span'), { className: 'ayah-number', textContent: '٢١' }));
    return { row };
  }
  if (spec.type === 'note') {
    const row = Object.assign(document.createElement('p'), { className: 'note' });
    return { row, update: () => (row.textContent = textOf(spec.text)) };
  }
  if (spec.type === 'credits') {
    const row = Object.assign(document.createElement('p'), { className: 'note credits' });
    const link = ([text, href]) => Object.assign(document.createElement('a'), { href, target: '_blank', rel: 'noopener', textContent: text });
    return { row, update: () => row.replaceChildren(...credits().map((part) => (typeof part === 'string' ? part : link(part)))) };
  }

  const id = `setting-${++uid}`;
  const row = document.createElement('div');
  row.className = 'row';
  row.hidden = spec.type === 'microphone'; // until there's more than one to choose from
  const label = Object.assign(document.createElement('label'), { id: `${id}-label`, htmlFor: id, textContent: spec.label });
  const hint = spec.hint ? document.createElement('small') : null;
  if (hint) label.append(hint);
  row.append(label);
  const { control, update } = CONTROLS[spec.type](spec, id);
  row.append(control);
  return {
    row,
    update: () => {
      if (hint) hint.textContent = textOf(spec.hint);
      update?.();
    },
  };
}

// Text that can depend on the settings: a string, or a function giving one.
const textOf = (text) => (typeof text === 'function' ? text() : text);

const CONTROLS = {
  toggle({ key }, id) {
    const input = switchInput(id);
    input.addEventListener('change', () => settings.set(key, input.checked));
    return { control: input, update: () => (input.checked = settings.get(key)) };
  },

  choice({ key, options }, id) {
    const group = document.createElement('div');
    group.className = 'choice';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', `${id}-label`);
    const inputs = options.map(([value, text]) => {
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: id, value: String(value) });
      input.addEventListener('change', () => settings.set(key, value));
      const option = document.createElement('label');
      option.append(input, text);
      group.append(option);
      return input;
    });
    // The option's own value, which can be a number
    return { control: group, update: () => inputs.forEach((input, i) => (input.checked = options[i][0] === settings.get(key))) };
  },

  select({ key, options }, id) {
    const select = Object.assign(document.createElement('select'), { id });
    select.append(...options.map(([value, text]) => new Option(text, value)));
    select.addEventListener('change', () => settings.set(key, select.value));
    return { control: select, update: () => (select.value = settings.get(key)) };
  },

  // From min to max in steps, or (with `values`) through a list of values, evenly spaced along it.
  range({ key, min, max, step, format, values }, id) {
    const control = document.createElement('div');
    control.className = 'range';
    const input = Object.assign(document.createElement('input'), values ? { type: 'range', id, min: 0, max: values.length - 1, step: 1 } : { type: 'range', id, min, max, step });
    const output = Object.assign(document.createElement('output'), { htmlFor: id });
    input.addEventListener('input', () => settings.set(key, values ? values[Number(input.value)] : Number(input.value)));
    control.append(input, output);
    return {
      control,
      update: () => {
        const value = settings.get(key);
        // A value that isn't in the list (from before it had one) sits at the nearest
        input.value = values ? values.reduce((best, v, i) => (Math.abs(v - value) < Math.abs(values[best] - value) ? i : best), 0) : value;
        input.setAttribute('aria-valuetext', format(value));
        output.value = format(value);
      },
    };
  },

  // A colour of the user's own, or '' for the theme's (shown as a reset button when it's been changed).
  colour({ key, themeVar }, id) {
    const control = document.createElement('div');
    control.className = 'colour';
    const input = Object.assign(document.createElement('input'), { type: 'color', id });
    const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Reset', title: 'Back to the theme’s colour' });
    input.addEventListener('input', () => settings.set(key, input.value));
    reset.addEventListener('click', () => settings.set(key, ''));
    control.append(reset, input);
    return {
      control,
      update: () => {
        input.value = settings.get(key) || cssColour(themeVar);
        reset.hidden = !settings.get(key);
      },
    };
  },

  // A tajweed colour: on or off, and which colour.
  rule({ key }, id) {
    const control = document.createElement('div');
    control.className = 'colour';
    const toggle = switchInput(id);
    const input = Object.assign(document.createElement('input'), { type: 'color' });
    input.setAttribute('aria-labelledby', `${id}-label`);
    const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Reset', title: 'Back to the theme’s colour' });
    toggle.addEventListener('change', () => settings.set(key, toggle.checked ? '' : 'off'));
    input.addEventListener('input', () => settings.set(key, input.value));
    reset.addEventListener('click', () => settings.set(key, ''));
    control.append(reset, input, toggle);
    return {
      control,
      update: () => {
        const value = settings.get(key);
        toggle.checked = value !== 'off';
        input.disabled = value === 'off';
        input.value = value.startsWith('#') ? value : cssColour(`--theme-${key}`);
        reset.hidden = !value.startsWith('#');
      },
    };
  },

  // The voice for the translation shown, and a button to hear it. Filled in when
  // the panel opens or the translation changes (see listVoices), since the
  // browser may still be loading them.
  voice(spec, id) {
    const control = document.createElement('div');
    control.className = 'colour';
    const select = Object.assign(document.createElement('select'), { id });
    const tryIt = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Try', title: 'Hear this voice' });
    const language = () => settings.get('translation');
    select.addEventListener('change', () => settings.set(`voice-${language()}`, select.value));
    tryIt.addEventListener('click', async () => {
      const lang = language();
      const text = await sample(lang);
      if (!text) return;
      if (settings.get(`voice-${lang}`) === RECORDED) {
        const played = await recording.play({ surah: 1, ayah: 1 }, text, { rate: settings.get('readingSpeed') });
        if (played !== null) return; // otherwise the device's voice, as when reading
      }
      const voice = await voiceFor(lang);
      speech.speak(text, { voice: voice?.id, lang: voice?.lang ?? lang, rate: settings.get('readingSpeed') }).catch((err) => console.warn(err));
    });
    control.append(tryIt, select);
    const update = () => {
      select.value = settings.get(`voice-${language()}`);
      if (select.selectedIndex < 0) select.value = ''; // not on this device
    };
    return { control, update };
  },

  // Whether auto search is on. Its tile turns it on and off too, so this asks
  // each time rather than keeping a setting.
  autoSearch(spec, id) {
    const input = switchInput(id);
    const update = () => autoSearch.status().then(({ running }) => (input.checked = running), (err) => console.warn(err));
    input.addEventListener('change', async () => {
      await (input.checked ? autoSearch.start() : autoSearch.stop()).catch((err) => console.warn(err));
      // Starting takes a moment, or doesn't happen at all if a permission is refused.
      for (const ms of [500, 1500, 3500]) setTimeout(update, ms);
    });
    // back from a permission prompt, or from the tile
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && update());
    return { control: input, update };
  },

  // Asks Android (13 and later) to add auto search's tile to Quick Settings.
  tile(spec, id) {
    const button = Object.assign(document.createElement('button'), { type: 'button', id, textContent: 'Add' });
    button.addEventListener('click', async () => {
      const { result } = await autoSearch.addTile().catch(() => ({ result: 'error' }));
      button.textContent = result === 'added' || result === 'already' ? 'Added' : 'Add';
    });
    // Older Androids can only add it by editing Quick Settings, so the row goes.
    const update = () => autoSearch.status().then(({ canAddTile }) => (button.closest('.row').hidden = !canAddTile), (err) => console.warn(err));
    return { control: button, update };
  },

  // Hands over to the tour, which the panel starts (see its constructor).
  tutorial(spec, id) {
    const button = Object.assign(document.createElement('button'), { type: 'button', id, textContent: 'Start' });
    button.addEventListener('click', () => button.dispatchEvent(new Event('tutorial', { bubbles: true })));
    return { control: button };
  },

  // Back in the app, the panel lists the voices again (see the constructor).
  installVoices(spec, id) {
    const button = Object.assign(document.createElement('button'), { type: 'button', id, textContent: 'Download' });
    button.addEventListener('click', () => speech.installVoices().catch((err) => console.warn(err)));
    return { control: button };
  },

  // Opens the offline voice over the panel (see the constructor).
  savedVoice(spec, id) {
    const button = Object.assign(document.createElement('button'), { type: 'button', id, textContent: 'Choose surahs' });
    button.addEventListener('click', () => button.dispatchEvent(new Event('saved-voice', { bubbles: true })));
    return { control: button };
  },

  // Hands over to the surah list's Heard tab (see the constructor).
  history(spec, id) {
    const button = Object.assign(document.createElement('button'), { type: 'button', id, textContent: 'Show' });
    button.addEventListener('click', () => button.dispatchEvent(new Event('history', { bubbles: true })));
    return { control: button };
  },

  // Opens in the browser, in the app too: Capacitor hands any page that isn't its own to the browser.
  link({ href, text }, id) {
    const link = Object.assign(document.createElement('a'), { id, href, target: '_blank', rel: 'noopener', className: 'button-link', textContent: text });
    return { control: link };
  },

  // Filled in when the panel opens (see listMicrophones), since the list can change.
  microphone({ key }, id) {
    const select = Object.assign(document.createElement('select'), { id });
    select.addEventListener('change', () => settings.set(key, select.value));
    const update = () => {
      select.value = settings.get(key);
      if (select.selectedIndex < 0) select.value = ''; // that one isn't plugged in now
    };
    return { control: select, update };
  },
};

function switchInput(id) {
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', id, className: 'switch' });
  input.setAttribute('role', 'switch');
  return input;
}

// The microphones the browser will name. They only have names once the page
// has been allowed to use one, and the row is hidden unless there's a choice.
async function listMicrophones(entry) {
  const select = entry.row.querySelector('select');
  let inputs = [];
  try {
    inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
  } catch {}
  entry.row.hidden = inputs.length < 2;
  const preferred = inputs.some((d) => d.label === PREFERRED_MICROPHONE);
  select.replaceChildren(
    new Option(preferred ? `Default (${PREFERRED_MICROPHONE})` : 'Default', ''),
    ...inputs.map((d, i) => new Option(d.label || `Microphone ${i + 1}`, d.deviceId)),
  );
  entry.update();
}

// The voices that can read the translation shown.
async function listVoices(entry) {
  const select = entry.row.querySelector('select');
  const language = settings.get('translation');
  const voices = await voicesFor(language);
  if (language !== settings.get('translation')) return; // changed again meanwhile
  const options = [
    new Option(voices.length ? 'Automatic' : 'None for this language on this device', ''),
    ...voices.map((v) => new Option(`${v.name} (${v.lang})`, v.id)),
  ];
  if (language === 'en' && recording.supported) options.unshift(new Option('Ibrahim Walk (recorded)', RECORDED));
  select.replaceChildren(...options);
  entry.update();
}

// Which version this is, at the very bottom, to tell builds apart: version.json
// comes from package.json (the server makes it, and app/build.mjs for the app).
function versionLine() {
  const line = Object.assign(document.createElement('p'), { className: 'version' });
  fetch('version.json')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`version.json: HTTP ${res.status}`))))
    .then(
      ({ version, commit }) => (line.textContent = `${NAME} · version ${version}${commit ? ` (${commit})` : ''}`),
      (err) => {
        console.warn(err);
        line.textContent = NAME;
      },
    );
  return line;
}

// Asks twice, since there's no undo.
function resetButton() {
  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'reset-all', textContent: 'Reset all settings' });
  let armed = false;
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = 'Tap again to reset everything';
      setTimeout(() => {
        armed = false;
        button.textContent = 'Reset all settings';
      }, 4000);
      return;
    }
    settings.reset();
    armed = false;
    button.textContent = 'Reset all settings';
  });
  return button;
}

/** A CSS custom property's value as #rrggbb, for a colour input. */
function cssColour(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase();
}
