// The phone app's stand-in for public/js/speech.js: Android's text-to-speech
// (SpeechPlugin.java), since the WebView has no voices of its own.
import { registerPlugin } from '@capacitor/core';

const Speech = registerPlugin('Speech');

export const supported = true;

/** Opens the voice engine's downloads (Google's lists every language it has), or else Android's text-to-speech settings. */
export function installVoices() {
  return Speech.installVoices();
}

let current = null; // { id, resolve, onWord } for what's being said
let count = 0;
Speech.addListener('word', ({ id, start, end }) => {
  if (current?.id === id) current.onWord?.(start, end);
});

/** @returns {Promise<{ id: string, name: string, lang: string, default: boolean }[]>} */
export async function voices() {
  try {
    return (await Speech.voices()).voices;
  } catch (err) {
    console.warn(err);
    return [];
  }
}

/**
 * Speaks `text`, stopping anything already being spoken.
 * @param {{ voice?: string, lang: string, rate: number, onWord?: (start: number, end: number) => void }} options
 * @returns {Promise<boolean>} true once it's all been said, false if it was stopped
 */
export function speak(text, { voice, lang, rate, onWord }) {
  stop();
  return new Promise((resolve, reject) => {
    const entry = { id: String(++count), resolve, onWord };
    const finish = (settle) => {
      if (current !== entry) return; // stopped already
      current = null;
      settle();
    };
    current = entry;
    Speech.speak({ id: entry.id, text, voice: voice ?? '', lang, rate }).then(
      ({ finished }) => finish(() => resolve(finished)),
      (err) => finish(() => reject(err)),
    );
  });
}

export function stop() {
  const entry = current;
  current = null;
  if (!entry) return;
  entry.resolve(false);
  Speech.stop().catch((err) => console.warn(err));
}
