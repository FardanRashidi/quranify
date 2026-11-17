// The user's settings: their defaults, the ones they've changed (kept in
// localStorage), and change notifications. settings-panel.js is the UI for them.
import { TRANSLATIONS } from './translations.js';

const STORAGE_KEY = 'settings';
// Settings that have been renamed, by their old names
const RENAMED = { voiceEn: 'voice-en', voiceMs: 'voice-ms' };

export const DEFAULTS = Object.freeze({
  // what Listen does once it has found the ayah
  listenFollow: true, // keep listening, and move along with the reciter
  listenRead: true, // read the translation aloud
  // appearance
  textSize: 100, // % of the normal size, for everything: 100 | 125 | 150
  theme: 'dark', // dark | light | auto (follow the device)
  accent: '', // '#rrggbb', or '' for the theme's own
  meter: true, // the level meter on the Listen button
  animations: true, // pulsing dot, smooth scrolling
  // verses
  translation: 'en', // a code from translations.js, or none
  arabicSize: 100, // %, on top of textSize
  translationSize: 100, // %, on top of textSize
  tajweed: true, // tajweed colours and the key above each surah
  tajweedKey: true,
  // Each tajweed colour: '#rrggbb', '' for the theme's own, or 'off'
  'tj-madd': '',
  'tj-qalqalah': '',
  'tj-ghunnah': '',
  'tj-ra': '',
  'tj-waqf': '',
  // following
  followScroll: true, // scroll to each ayah as following or reading aloud reaches it
  followMin: 2, // seconds between checks, at the least (short ayahs, and the end of long ones)
  followMax: 5, // and at the most (early in a long ayah)
  // reading aloud
  readingSpeed: 1, // 1 is the voice's normal speed
  // The voice for each translation: a device voice's id, or '' for the device's
  // own. English can also be the recording (reader.js's RECORDED), and is by default.
  ...Object.fromEntries(TRANSLATIONS.map(({ code }) => [`voice-${code}`, ''])),
  'voice-en': 'ibrahim-walk',
  listenWhileReading: false, // check while reading aloud (with headphones, the microphone can't hear it)
  readEveryAyah: true, // following: read each ayah in turn, faster when behind, rather than skip to the reciter's
  // listening
  source: 'mic', // mic | tab
  microphone: '', // a deviceId, or '' for the default
  clipSeconds: 8, // how much recent audio each attempt sends
  giveUpAfter: 60, // seconds of listening without finding anything
  masjidMode: false, // a big echoing room: searches hear more, and it keeps trying for longer
  prayerMode: false, // listening to a prayer: Al-Fatiha first, then a surah, each rakaah
});

/** textSize's choices, for the settings panel and the tutorial */
export const TEXT_SIZES = [
  [100, 'Normal'],
  [125, 'Large'],
  [150, 'Largest'],
];

const values = { ...DEFAULTS, ...load() };
const listeners = new Set();

/** @param {keyof DEFAULTS} key */
export function get(key) {
  return values[key];
}

/** @param {keyof DEFAULTS} key */
export function set(key, value) {
  if (values[key] === value) return;
  values[key] = value;
  save();
  for (const listener of listeners) listener(key, value);
}

/** Everything back to its default. */
export function reset() {
  for (const key of Object.keys(DEFAULTS)) set(key, DEFAULTS[key]);
}

/** @param {(key: keyof DEFAULTS, value: any) => void} listener called after each change */
export function onChange(listener) {
  listeners.add(listener);
}

function load() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
  // Anything from an older version that no longer fits is dropped.
  return Object.fromEntries(
    Object.entries(saved ?? {})
      .map(([key, value]) => [RENAMED[key] ?? key, value])
      .filter(([key, value]) => key in DEFAULTS && typeof value === typeof DEFAULTS[key]),
  );
}

// Only what differs from the defaults, so a changed default reaches everyone who left it alone.
function save() {
  const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== DEFAULTS[key]));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
  } catch {}
}
