// Quran speech-to-text on the phone. The model runs in native code with ONNX
// Runtime (WhisperPlugin.java), which can use several CPU cores; WebAssembly in
// the WebView only gets one.
import { registerPlugin } from '@capacitor/core';

const Whisper = registerPlugin('Whisper');
let loading = null;
let onProgress = null;
Whisper.addListener('progress', (progress) => onProgress?.(progress));

/** @param {(progress: { loaded: number, total: number }) => void} [progress] download progress, in bytes */
export function loadModel(progress) {
  if (progress) onProgress = progress;
  loading ??= Whisper.load().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** @param {ArrayBuffer} pcm 16 kHz mono s16le audio */
export async function transcribe(pcm) {
  await loadModel();
  const { text } = await Whisper.transcribe({ pcm: toBase64(pcm) });
  return text.trim();
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
