// The phone app's stand-in for public/js/api.js: the same functions, but
// everything the server does happens here instead. The Quran speech model runs
// on the phone, and the Quran text comes with the app.
import { Capacitor, SystemBars, SystemBarsStyle, registerPlugin } from '@capacitor/core';
import { createQuran, downloadEdition, isBasmala, BUNDLED_EDITIONS } from '../../lib/quran.js';
import { loadModel, transcribe } from './asr.js';

const quran = createQuran(cachedEdition);
const Screen = registerPlugin('Screen');
const AutoSearch = registerPlugin('AutoSearch');
const SavedVoice = registerPlugin('SavedVoice');

/**
 * @param {number | null | undefined} near word index of the last match, to keep following from there
 * @param {number | null | undefined} surah only look in this surah
 * @param {{ fatiha?: boolean }} [options] Al-Fatiha is expected: see lib/quran.js's locate
 */
export async function recognizeQuran(pcm, near, surah, options = {}) {
  const transcript = await transcribe(pcm);
  return (await quran.locate(transcript, near ?? null, surah ?? null, options)) ?? (isBasmala(transcript) ? { basmala: true } : null);
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

let listening = false;

/** While Listen is on: keeps the microphone going with the screen off (ListeningService.java). */
export function keepListening(on) {
  if (on === listening || !Capacitor.isNativePlatform()) return;
  listening = on;
  Screen.keepListening({ on }).catch((err) => console.warn(err));
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

/**
 * The recorded voice saved on the phone (SavedVoicePlugin.java), so the translation
 * can be read aloud without the internet. public/js/saved-voice.js keeps track of it.
 * Ayahs are numbered from 1 (1:1) to 6236 (114:6), as the recording's files are.
 */
export const savedVoice = {
  supported: Capacitor.isNativePlatform(),
  /** @returns {Promise<{ path: string, ayahs: number[], bytes: number }>} what's saved, and where */
  status: () => SavedVoice.status(),
  /**
   * Saves ayahs `from`–`to` that aren't saved yet, from `url` ({n} for each one's number),
   * after any saves already asked for. Resolves true once they all are, false if cancelled.
   */
  save: async (id, url, from, to) => (await SavedVoice.save({ id, url, from, to })).saved,
  /** Stops one save (by its id), or without an id, all of them. */
  cancel: (id) => SavedVoice.cancel(id ? { id } : {}),
  /** Deletes ayahs `from`–`to`, or without them, every one. */
  remove: (from, to) => SavedVoice.remove(from ? { from, to } : {}),
  /** @param {(e: { id: string }) => void} onStart a save has begun @param {(e: { id: string, ayah: number, bytes: number }) => void} onSaved one more ayah */
  listen(onStart, onSaved) {
    SavedVoice.addListener('start', onStart);
    SavedVoice.addListener('saved', onSaved);
  },
  /** A saved ayah's file, as a URL the page can fetch. */
  fileUrl: (path, n) => Capacitor.convertFileSrc(`${path}/${n}.mp3`),
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
