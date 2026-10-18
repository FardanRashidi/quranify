// The settings panel: a dialog with a control for every setting in settings.js.
// The controls follow the settings, so a change made elsewhere (like the
// footer's tajweed button) shows here too.
import * as settings from './settings.js';
import { arabicParagraph } from './verses-view.js';
import * as speech from './speech.js';
import { supported as canReadAloud, voiceFor, voicesFor } from './reader.js';

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

// What the voice's "try" button says: 1:1 in each translation.
const SAMPLE = {
  en: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
  ms: 'Dengan nama Allah, Yang Maha Pemurah, lagi Maha Mengasihani.',
};

const percent = (value) => `${value}%`;
const seconds = (value) => `${value} s`;
const NEXT_LISTEN = 'takes effect the next time you press Listen';
const tajweedOn = () => settings.get('tajweed');
const translated = (language) => () => canReadAloud && settings.get('translation') === language;

/**
 * Each section's rows. `when` hides a row that doesn't apply here, and
 * `enabledWhen` greys out one that does nothing with the current settings.
 */
const SECTIONS = [
  {
    title: 'appearance',
    rows: [
      { key: 'theme', label: 'theme', type: 'choice', options: [['dark', 'dark'], ['light', 'light'], ['auto', 'auto']], hint: 'auto follows the device' },
      { key: 'accent', label: 'accent colour', type: 'colour', themeVar: '--theme-accent' },
      { key: 'meter', label: 'level meter', type: 'toggle' },
      { key: 'animations', label: 'animations', type: 'toggle', hint: 'pulsing dot, smooth scrolling' },
    ],
  },
  {
    title: 'verses',
    rows: [
      { type: 'preview' },
      { key: 'translation', label: 'translation', type: 'choice', options: [['en', 'English'], ['ms', 'Melayu'], ['none', 'none']] },
      { key: 'arabicSize', label: 'arabic size', type: 'range', min: 70, max: 200, step: 5, format: percent },
      { key: 'translationSize', label: 'translation size', type: 'range', min: 70, max: 200, step: 5, format: percent },
      { key: 'tajweed', label: 'tajweed colours', type: 'toggle' },
      { key: 'tajweedKey', label: 'key above each surah', type: 'toggle', enabledWhen: tajweedOn },
      { key: 'tj-madd', label: 'long, 4–6 counts', type: 'rule', enabledWhen: tajweedOn },
      { key: 'tj-qalqalah', label: 'qalqalah', type: 'rule', enabledWhen: tajweedOn },
      { key: 'tj-ghunnah', label: 'nasal (ghunnah)', type: 'rule', enabledWhen: tajweedOn },
      { key: 'tj-ra', label: 'heavy ra', type: 'rule', enabledWhen: tajweedOn },
      { key: 'tj-waqf', label: 'waqf signs', type: 'rule', enabledWhen: tajweedOn },
    ],
  },
  {
    title: 'following',
    rows: [
      { key: 'followScroll', label: 'scroll along', type: 'toggle', hint: 'to each ayah as following or reading aloud reaches it' },
      {
        key: 'followMin',
        label: 'shortest wait between checks',
        type: 'range',
        min: 1,
        max: 5,
        step: 0.5,
        format: seconds,
        hint: 'through short ayahs, and near the end of a long one',
      },
      { key: 'followMax', label: 'longest wait between checks', type: 'range', min: 2, max: 15, step: 1, format: seconds, hint: 'early in a long ayah' },
    ],
  },
  {
    title: 'reading aloud',
    rows: [
      {
        key: 'readingSpeed',
        label: 'speed',
        type: 'range',
        min: 0.5,
        max: 2,
        step: 0.05,
        format: (value) => `${value}×`,
        when: () => canReadAloud,
      },
      { key: 'voiceEn', label: 'voice', type: 'voice', language: 'en', when: translated('en') },
      { key: 'voiceMs', label: 'voice', type: 'voice', language: 'ms', when: translated('ms') },
      {
        key: 'listenWhileReading',
        label: 'keep listening while reading',
        type: 'toggle',
        hint: 'for headphones. Otherwise checks wait while it reads, so the microphone doesn’t hear the voice',
        when: () => canReadAloud,
      },
      { type: 'note', text: 'this browser can’t read aloud', when: () => !canReadAloud },
    ],
  },
  {
    title: 'listening',
    rows: [
      {
        key: 'source',
        label: 'audio source',
        type: 'choice',
        options: [['mic', 'microphone'], ['tab', 'tab / system']],
        hint: NEXT_LISTEN,
        when: () => Boolean(navigator.mediaDevices?.getDisplayMedia),
      },
      { key: 'microphone', label: 'microphone', type: 'microphone', hint: NEXT_LISTEN },
      { key: 'clipSeconds', label: 'audio sent per try', type: 'range', min: 5, max: 12, step: 1, format: seconds, hint: 'more is surer, less is quicker' },
      { key: 'giveUpAfter', label: 'give up after', type: 'range', min: 20, max: 300, step: 10, format: seconds, hint: 'of listening without finding the ayah' },
    ],
  },
];

let uid = 0;

export class SettingsPanel {
  #dialog;
  #rows = []; // { row, update() }

  /** @param {HTMLDialogElement} dialog */
  constructor(dialog) {
    this.#dialog = dialog;
    const body = dialog.querySelector('.settings-body');
    for (const { title, rows } of SECTIONS) {
      const section = document.createElement('section');
      section.append(Object.assign(document.createElement('h3'), { textContent: title }));
      for (const spec of rows) {
        const built = build(spec);
        this.#rows.push({ ...built, spec });
        section.append(built.row);
      }
      body.append(section);
    }
    body.append(resetButton());

    dialog.querySelector('.close').addEventListener('click', () => dialog.close());
    // A click on the backdrop lands on the dialog itself.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    // Open, the panel is a step in the history, so Back (in the browser, or the
    // phone's back button in the app) closes it rather than leaving the page.
    dialog.addEventListener('close', () => {
      if (history.state?.settings) history.back();
    });
    addEventListener('popstate', () => {
      if (dialog.open) dialog.close();
    });
    settings.onChange(() => this.refresh());
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
  if (spec.type === 'note') return { row: Object.assign(document.createElement('p'), { className: 'note', textContent: spec.text }) };

  const id = `setting-${++uid}`;
  const row = document.createElement('div');
  row.className = 'row';
  row.hidden = spec.type === 'microphone'; // until there's more than one to choose from
  const label = Object.assign(document.createElement('label'), { id: `${id}-label`, htmlFor: id, textContent: spec.label });
  if (spec.hint) label.append(Object.assign(document.createElement('small'), { textContent: spec.hint }));
  row.append(label);
  const { control, update } = CONTROLS[spec.type](spec, id);
  row.append(control);
  return { row, update };
}

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
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: id, value });
      input.addEventListener('change', () => settings.set(key, value));
      const option = document.createElement('label');
      option.append(input, text);
      group.append(option);
      return input;
    });
    return { control: group, update: () => inputs.forEach((input) => (input.checked = input.value === settings.get(key))) };
  },

  range({ key, min, max, step, format }, id) {
    const control = document.createElement('div');
    control.className = 'range';
    const input = Object.assign(document.createElement('input'), { type: 'range', id, min, max, step });
    const output = Object.assign(document.createElement('output'), { htmlFor: id });
    input.addEventListener('input', () => settings.set(key, Number(input.value)));
    control.append(input, output);
    return {
      control,
      update: () => {
        input.value = settings.get(key);
        output.value = format(settings.get(key));
      },
    };
  },

  // A colour of the user's own, or '' for the theme's (shown as a reset button when it's been changed).
  colour({ key, themeVar }, id) {
    const control = document.createElement('div');
    control.className = 'colour';
    const input = Object.assign(document.createElement('input'), { type: 'color', id });
    const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'reset', title: 'Back to the theme’s colour' });
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
    const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'reset', title: 'Back to the theme’s colour' });
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

  // A voice for one translation, and a button to hear it. Filled in when the
  // panel opens (see listVoices), since the browser may still be loading them.
  voice({ key, language }, id) {
    const control = document.createElement('div');
    control.className = 'colour';
    const select = Object.assign(document.createElement('select'), { id });
    const sample = Object.assign(document.createElement('button'), { type: 'button', textContent: 'try', title: 'Hear this voice' });
    select.addEventListener('change', () => settings.set(key, select.value));
    sample.addEventListener('click', async () => {
      const voice = await voiceFor(language);
      speech.speak(SAMPLE[language], { voice: voice?.id, lang: voice?.lang ?? language, rate: settings.get('readingSpeed') }).catch((err) => console.warn(err));
    });
    control.append(sample, select);
    const update = () => {
      select.value = settings.get(key);
      if (select.selectedIndex < 0) select.value = ''; // not on this device
    };
    return { control, update };
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
  select.replaceChildren(
    new Option('default', ''),
    ...inputs.map((d, i) => new Option(d.label || `microphone ${i + 1}`, d.deviceId)),
  );
  entry.update();
}

// The voices that can read a translation. Without one, the device reads it in
// whatever voice it has, which may not know the language.
async function listVoices(entry) {
  const select = entry.row.querySelector('select');
  const voices = await voicesFor(entry.spec.language);
  select.replaceChildren(
    new Option(voices.length ? 'automatic' : 'none for this language on this device', ''),
    ...voices.map((v) => new Option(`${v.name} (${v.lang})`, v.id)),
  );
  entry.update();
}

// Asks twice, since there's no undo.
function resetButton() {
  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'reset-all', textContent: 'reset all settings' });
  let armed = false;
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = 'tap again to reset everything';
      setTimeout(() => {
        armed = false;
        button.textContent = 'reset all settings';
      }, 4000);
      return;
    }
    settings.reset();
    armed = false;
    button.textContent = 'reset all settings';
  });
  return button;
}

/** A CSS custom property's value as #rrggbb, for a colour input. */
function cssColour(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase();
}
