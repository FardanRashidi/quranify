// Runs on the audio thread: mixes the input down to mono and hands it to the
// main thread in small batches.
const BATCH = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  batch = new Float32Array(BATCH);
  filled = 0;

  process([channels]) {
    const frames = channels[0]?.length ?? 0;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i];
      this.batch[this.filled++] = sum / channels.length;
      if (this.filled === BATCH) {
        this.port.postMessage(this.batch, [this.batch.buffer]);
        this.batch = new Float32Array(BATCH);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
