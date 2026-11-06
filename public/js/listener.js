// Captures audio (microphone or a shared tab), keeps the last half minute in a
// ring buffer, and turns them into clips the speech model understands.
// Half a minute is as much as the speech model takes at once: enough to look back,
// when the reciter turns up in another surah, for whether they finished the last.
const RING_SECONDS = 30;
const TARGET_RATE = 16000; // what the speech model expects
const MAX_GAIN = 20; // how far quiet recordings get boosted
const SILENCE_RMS = 0.002; // ≈ -54 dBFS; quieter than this counts as silence
// A pause: this long without sound, after some. Reciters stop for breath at the
// end of an ayah (and at some stops within one), longer than the gaps between words.
const PAUSE = 0.35; // s
// What counts as sound during one: louder than this much of the loudest lately (-10 dB),
// so a room's background noise, or the echo dying away, can still be a pause. Over two
// reciters' Al-Mulk 1–10, it caught 17 of the 18 ayah ends with background noise up to
// 25 dB below the recitation, each 0.38 s after the sound stopped.
const PAUSE_LEVEL = 0.3;
const LOUDEST_MEMORY = 4; // s: the loudest lately fades over about this long
// Silence longer than this is the reciter stopping, rather than a breath between ayahs or
// surahs: it doesn't count towards how long they've been reciting.
const STOP = 2.5; // s

export class Listener {
  /** Called when the audio source goes away (e.g. the user stops tab sharing). */
  onEnded = null;
  /** Called once each time the sound stops for a pause, with when it stopped (performance.now()). */
  onPause = null;

  #stream = null;
  #ctx = null;
  #analyser = null;
  #freq = null;
  #ring = null;
  #written = 0;
  #lastChunkAt = 0;
  #loudest = 0; // RMS, fading
  #quiet = Infinity; // seconds since the last sound: none yet, so no pause to report
  #reciting = 0; // seconds of reciting heard since it started: sound, and the pauses in it shorter than STOP

  get active() {
    return this.#ctx !== null;
  }

  get bufferedSeconds() {
    return this.#ctx ? Math.min(this.#written, this.#ring.length) / this.#ctx.sampleRate : 0;
  }

  /**
   * Seconds of reciting heard since it started: sound and the pauses within it, but not
   * a stop (silence of STOP or more). The difference between two, times the reciter's
   * pace, is about how many words they said in between.
   */
  get recitingSeconds() {
    return this.#reciting;
  }

  /**
   * @param {'mic' | 'tab'} source
   * @param {string} [microphone] a deviceId; one that's gone falls back to the default
   */
  async start(source, microphone = '') {
    if (!navigator.mediaDevices) {
      throw new Error('audio capture needs a secure page (https or localhost)');
    }
    // Voice processing is tuned for calls, and can strip a recitation out as echo or noise, so turn it all off.
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const stream =
      source === 'tab'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio, systemAudio: 'include' })
        : await navigator.mediaDevices.getUserMedia({ audio: microphone ? { ...audio, deviceId: { ideal: microphone } } : audio });

    try {
      stream.getVideoTracks().forEach((track) => track.stop());
      const [track] = stream.getAudioTracks();
      if (!track) throw new Error('no audio was shared — pick a tab and enable "Share tab audio"');
      track.addEventListener('ended', () => this.onEnded?.());

      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
      const input = ctx.createMediaStreamSource(stream);
      const capture = new AudioWorkletNode(ctx, 'capture');
      const mute = ctx.createGain();
      mute.gain.value = 0;
      // Routing to the (muted) destination keeps the worklet running in every browser.
      input.connect(capture).connect(mute).connect(ctx.destination);

      this.#analyser = ctx.createAnalyser();
      this.#analyser.fftSize = 2048;
      this.#analyser.smoothingTimeConstant = 0.6;
      this.#analyser.minDecibels = -90;
      this.#analyser.maxDecibels = -10;
      this.#freq = new Uint8Array(this.#analyser.frequencyBinCount);
      input.connect(this.#analyser);

      this.#ring = new Float32Array(ctx.sampleRate * RING_SECONDS);
      this.#written = 0;
      this.#loudest = 0;
      this.#quiet = Infinity;
      this.#reciting = 0;
      capture.port.onmessage = ({ data }) => this.#push(data);
      this.#stream = stream;
      this.#ctx = ctx;
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      throw err;
    }
  }

  stop() {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#ctx?.close();
    this.#stream = this.#ctx = this.#analyser = null;
  }

  /**
   * The most recent audio as 16 kHz mono s16le PCM, or with `endAt`, the audio up
   * to then (as far back as it's kept). `audible` is how many seconds of it aren't
   * silence; `endedAt` is the performance.now() timestamp of the clip's last sample,
   * and `recitingSeconds` what `recitingSeconds` was then (only for the most recent).
   * @param {number} maxSeconds
   * @param {number | null} [endAt] performance.now()
   */
  async clip(maxSeconds, endAt = null) {
    const rate = this.#ctx.sampleRate;
    const ring = this.#ring;
    const kept = Math.min(this.#written, ring.length);
    const back = endAt === null ? 0 : Math.min(kept, Math.max(0, Math.round(((this.#lastChunkAt - endAt) / 1000) * rate)));
    const n = Math.min(kept - back, Math.round(maxSeconds * rate));
    const endedAt = this.#lastChunkAt - (back / rate) * 1000;
    const recitingSeconds = endAt === null ? this.#reciting : null;

    const end = (this.#written - back) % ring.length;
    const start = (end - n + ring.length) % ring.length;
    const samples = new Float32Array(n);
    if (start + n <= ring.length) {
      samples.set(ring.subarray(start, start + n));
    } else {
      samples.set(ring.subarray(start));
      samples.set(ring.subarray(0, end), ring.length - start);
    }

    // Measure how much of the clip actually has sound in it, in 100 ms windows.
    const window = Math.round(rate / 10);
    let audibleWindows = 0;
    let peak = 0;
    for (let w = 0; w + window <= n; w += window) {
      let sumSquares = 0;
      for (let i = w; i < w + window; i++) {
        sumSquares += samples[i] * samples[i];
        peak = Math.max(peak, Math.abs(samples[i]));
      }
      if (Math.sqrt(sumSquares / window) > SILENCE_RMS) audibleWindows++;
    }

    // Normalise quiet recordings, so a phone across the room sounds like one close by.
    const gain = peak > 0 ? Math.min(0.9 / peak, MAX_GAIN) : 1;
    const resampled = await resample(samples, rate, TARGET_RATE);
    const pcm = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      pcm[i] = Math.max(-1, Math.min(1, resampled[i] * gain)) * 0x7fff;
    }

    return { pcm: pcm.buffer, duration: n / rate, audible: audibleWindows / 10, endedAt, recitingSeconds };
  }

  /** Current loudness in `count` log-spaced bands (60 Hz – 8 kHz), each 0..1. */
  levels(count) {
    if (!this.#analyser) return new Array(count).fill(0);
    this.#analyser.getByteFrequencyData(this.#freq);
    const hzPerBin = this.#ctx.sampleRate / this.#analyser.fftSize;
    const levels = [];
    for (let i = 0; i < count; i++) {
      const lo = Math.floor((60 * (8000 / 60) ** (i / count)) / hzPerBin);
      const hi = Math.min(Math.ceil((60 * (8000 / 60) ** ((i + 1) / count)) / hzPerBin), this.#freq.length - 1);
      let max = 0;
      for (let bin = lo; bin <= hi; bin++) max = Math.max(max, this.#freq[bin]);
      levels.push(max / 255);
    }
    return levels;
  }

  #push(chunk) {
    const ring = this.#ring;
    const pos = this.#written % ring.length;
    const first = Math.min(chunk.length, ring.length - pos);
    ring.set(chunk.subarray(0, first), pos);
    ring.set(chunk.subarray(first), 0);
    this.#written += chunk.length;
    this.#lastChunkAt = performance.now();
    this.#listenForPause(chunk);
  }

  // Each batch from the worklet is about 40 ms.
  #listenForPause(chunk) {
    if (!this.#ctx) return; // a last batch, after stop()
    let sumSquares = 0;
    for (let i = 0; i < chunk.length; i++) sumSquares += chunk[i] * chunk[i];
    const rms = Math.sqrt(sumSquares / chunk.length);
    const seconds = chunk.length / this.#ctx.sampleRate;
    this.#loudest = Math.max(rms, this.#loudest * Math.exp(-seconds / LOUDEST_MEMORY));
    if (rms > SILENCE_RMS && rms >= this.#loudest * PAUSE_LEVEL) {
      if (this.#quiet < STOP) this.#reciting += this.#quiet; // a pause, not a stop
      this.#reciting += seconds;
      this.#quiet = 0;
      return;
    }
    const before = this.#quiet;
    this.#quiet += seconds;
    if (before < PAUSE && this.#quiet >= PAUSE) this.onPause?.(this.#lastChunkAt - this.#quiet * 1000);
  }
}

async function resample(samples, fromRate, toRate) {
  const ctx = new OfflineAudioContext(1, Math.ceil((samples.length * toRate) / fromRate), toRate);
  const buffer = ctx.createBuffer(1, samples.length, fromRate);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return (await ctx.startRendering()).getChannelData(0);
}
