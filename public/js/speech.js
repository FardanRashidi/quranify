// Reads text aloud with the browser's own voices (the Web Speech API). The
// phone app swaps this file for app/src/speech.js, which uses Android's, since
// its WebView has none.
const synth = globalThis.speechSynthesis;

/** Whether anything can be read aloud here. */
export const supported = Boolean(synth && globalThis.SpeechSynthesisUtterance);

/** Opens somewhere to download more voices: the app can (app/src/speech.js), a browser can't. */
export const installVoices = null;

let current = null; // { utterance, resolve }: also keeps the utterance from being garbage-collected mid-way (Chrome)

/** @returns {Promise<{ id: string, name: string, lang: string, default: boolean }[]>} */
export function voices() {
  if (!supported) return Promise.resolve([]);
  const list = () => synth.getVoices().map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, default: v.default }));
  if (synth.getVoices().length) return Promise.resolve(list());
  // Chrome fills the list in shortly after the page loads.
  return new Promise((resolve) => {
    const done = () => resolve(list());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

/**
 * Speaks `text`, stopping anything already being spoken.
 * @param {{ voice?: string, lang: string, rate: number, onWord?: (start: number, end: number) => void }} options
 *   `voice` is an id from voices(); `onWord` gets each word's place in `text` as it's spoken, where the voice reports it
 * @returns {Promise<boolean>} true once it's all been said, false if it was stopped
 */
export function speak(text, { voice, lang, rate, onWord }) {
  stop();
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const entry = { utterance, resolve };
    const finish = (settle) => {
      if (current !== entry) return; // stopped already
      current = null;
      settle();
    };
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.voice = synth.getVoices().find((v) => v.voiceURI === voice) ?? null;
    utterance.onboundary = (e) => {
      if (e.name !== 'word' || current !== entry) return;
      const length = e.charLength || text.slice(e.charIndex).search(/\s|$/);
      onWord?.(e.charIndex, e.charIndex + length);
    };
    utterance.onend = () => finish(() => resolve(true));
    utterance.onerror = (e) =>
      finish(() => (e.error === 'interrupted' || e.error === 'canceled' ? resolve(false) : reject(new Error(e.error))));
    current = entry;
    synth.speak(utterance);
  });
}

export function stop() {
  const entry = current;
  current = null;
  entry?.resolve(false);
  if (supported) synth.cancel();
}
