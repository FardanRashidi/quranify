// The phone app's stand-in for public/js/api.js: the same functions, but
// everything the server does happens here instead. The Quran speech model runs
// on the phone, and the Quran text comes with the app.
import { Capacitor, SystemBars, SystemBarsStyle, registerPlugin } from '@capacitor/core';
import { createQuran, downloadEdition, BUNDLED_EDITIONS } from '../../lib/quran.js';
import { loadModel, transcribe } from './asr.js';

const quran = createQuran(cachedEdition);
const Screen = registerPlugin('Screen');
const AutoSearch = registerPlugin('AutoSearch');

/**
 * @param {number | null | undefined} near word index of the last match, to keep following from there
 * @param {number | null | undefined} surah only look in this surah
 */
export async function recognizeQuran(pcm, near, surah) {
  return quran.locate(await transcribe(pcm), near ?? null, surah ?? null);
}

/**
 * Resolves once the speech model is loaded (a one-time download the first time).
 * @param {(progress: { loaded: number, total: number }) => void} [onProgress] bytes so far
 */
export async function warmUpQuran(onProgress) {
  await Promise.all([loadModel(onProgress), quran.warmUp()]);
}

export function fetchSurahs() {
  return quran.listSurahs();
}

export function fetchSurah(number, translation) {
  return quran.getSurah(number, translation);
}

/** Light status bar icons on the dark theme, dark ones on the light theme. */
export function styleSystemBars(dark) {
  if (!Capacitor.isNativePlatform()) return;
  SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch((err) => console.warn(err));
}

let screenOn = null;

/** Keeps the screen from going to sleep (ScreenPlugin.java: the WebView has no wake lock), or lets it again. */
export function keepScreenOn(on) {
  if (on === screenOn || !Capacitor.isNativePlatform()) return;
  screenOn = on;
  Screen.keepOn({ on }).catch((err) => console.warn(err));
}

/**
 * Auto search (AutoSearchService.java): listens in the background, with the screen
 * off too, and posts a notification for each surah it recognises. Its Quick
 * Settings tile turns it on and off, and so can the settings panel.
 */
export const autoSearch = {
  supported: Capacitor.isNativePlatform(),
  /** @returns {Promise<{ running: boolean, canAddTile: boolean }>} */
  status: () => AutoSearch.status(),
  /** Asks for the microphone and notifications first, if it needs to. */
  start: () => AutoSearch.start(),
  stop: () => AutoSearch.stop(),
  /** Android 13+ asks the user to add the tile. @returns {Promise<{ result: 'added' | 'already' | 'declined' | 'error' }>} */
  addTile: () => AutoSearch.addTile(),
  /** What it's heard, newest first. @returns {Promise<{ surah: number, from: number, to: number, start: number, end: number }[]>} the ayahs, and when (ms) */
  history: async () => (await AutoSearch.history()).entries.reverse(),
  clearHistory: () => AutoSearch.clearHistory(),
};

/** Calls back with { surah, ayah } when the app is opened from one of auto search's notifications. */
export function onOpenAyah(callback) {
  if (Capacitor.isNativePlatform()) AutoSearch.addListener('open', callback);
}

// The Quran text and the default translation come with the app (app/build.mjs).
// Other translations are downloaded the first time and kept in the app's storage.
async function cachedEdition(id) {
  const cache = await caches.open('quran-text');
  const key = `/quran/${id}.json`;
  if (BUNDLED_EDITIONS.includes(id)) {
    cache.delete(key); // downloaded before the app came with it
    const res = await fetch(`quran/${id}.json`);
    if (!res.ok) throw new Error(`The Quran text (${id}) is missing from the app: HTTP ${res.status}`);
    return res.json();
  }
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const surahs = await downloadEdition(id);
  await cache.put(key, new Response(JSON.stringify(surahs), { headers: { 'Content-Type': 'application/json' } }));
  return surahs;
}
