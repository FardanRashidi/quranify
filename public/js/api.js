// Calls to the quran-finder server. The phone app (app/) swaps this file for
// app/src/api.js, which does the same work on the phone instead.
// Where the backend lives. Empty means "same origin as the page".
const API_BASE = '';

/**
 * @param {ArrayBuffer} pcm 16 kHz mono s16le audio
 * @param {number | null | undefined} near word index of the last match, to keep following from there
 */
export async function recognizeQuran(pcm, near) {
  const query = near != null ? `?near=${near}` : '';
  const res = await fetch(`${API_BASE}/api/quran/recognize${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: pcm,
  });
  return (await parse(res)).match;
}

/**
 * Resolves once the server has its speech model loaded (slow the very first time).
 * The app's version also reports download progress; the server's doesn't.
 */
export async function warmUpQuran() {
  await parse(await fetch(`${API_BASE}/api/quran/warmup`, { method: 'POST' }));
}

export async function fetchSurah(number, translation) {
  const res = await fetch(`${API_BASE}/api/quran/surah/${number}?translation=${encodeURIComponent(translation)}`);
  return (await parse(res)).surah;
}

/** The phone app restyles its status bar to suit the theme; a browser has nothing to do. */
export function styleSystemBars(dark) {}

/**
 * Auto search (listening in the background, from a Quick Settings tile) is only
 * in the Android app: see app/src/api.js.
 */
export const autoSearch = { supported: false };

/** In the app, calls back with { surah, ayah } when it's opened from one of auto search's notifications. */
export function onOpenAyah(callback) {}

// The browser lets go of a wake lock by itself whenever the page is hidden, so
// it's asked for again when the page is back.
let screenOn = false;
let wakeLock = null; // a promise of the WakeLockSentinel, while there is one

/** Keeps the screen from going to sleep, or lets it again. */
export function keepScreenOn(on) {
  screenOn = on;
  if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
    const request = navigator.wakeLock.request('screen');
    wakeLock = request;
    request.then(
      (sentinel) => sentinel.addEventListener('release', () => wakeLock === request && (wakeLock = null)),
      () => wakeLock === request && (wakeLock = null), // not allowed right now (e.g. battery saver)
    );
  } else if (!on && wakeLock) {
    const request = wakeLock;
    wakeLock = null;
    request.then((sentinel) => sentinel.release(), () => {});
  }
}

document.addEventListener('visibilitychange', () => keepScreenOn(screenOn));

async function parse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
