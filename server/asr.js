// Speech-to-text for Quran recitation: Tarteel's Whisper model fine-tuned on
// recitation, converted to ONNX and run locally on the CPU via transformers.js.
// The model (~400 MB) downloads into .cache/models/ the first time it's used.
import os from 'node:os';
import { pipeline, env } from '@huggingface/transformers';
import { dataPath } from './paths.js';

const MODEL = 'YunusZJ/whisper-base-ar-quran-ONNX'; // ONNX export of tarteel-ai/whisper-base-ar-quran

env.cacheDir = dataPath('.cache', 'models');

let model = null;
let queue = Promise.resolve(); // one transcription at a time; they'd only fight over the CPU

export function loadModel() {
  // In a container limited to fewer CPUs than the machine has, onnxruntime still
  // starts a thread per core and they fight (3.5 s vs 1.4 s per clip on 2 cores).
  // Otherwise its default (one per physical core) is fastest.
  const cpus = os.availableParallelism();
  const session_options = cpus < os.cpus().length ? { intraOpNumThreads: cpus } : {};
  model ??= pipeline('automatic-speech-recognition', MODEL, { dtype: 'fp32', session_options }).catch((err) => {
    model = null;
    throw err;
  });
  return model;
}

/** @param {Buffer} pcm 16 kHz mono s16le audio */
export async function transcribe(pcm) {
  const asr = await loadModel();
  const audio = new Float32Array(pcm.length >> 1);
  for (let i = 0; i < audio.length; i++) audio[i] = pcm.readInt16LE(i * 2) / 32768;

  const run = queue.then(() => asr(audio, { language: 'arabic', task: 'transcribe' }));
  queue = run.catch(() => {});
  return (await run).text.trim();
}
