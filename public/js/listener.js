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
// The meter's bars: how many, from this low a sound to this high, and from this quiet to this loud.
const METER_BARS = 5;
const METER_FROM = 60; // Hz
const METER_TO = 8000;
const METER_QUIET = -90; // dB, in the loudest part of a bar's band
const METER_LOUD = -10;
// The background: the quietest each band has been lately. A voice stops, for a breath or
// between words; what's still there then is the room: its noise, and its echo dying away.
const BACKGROUND_MEMORY = 12; // s: reciters stop for breath more often than this (8 s wasn't enough: a long phrase looked like noise)
const BACKGROUND_STEP = 1; // s: the memory is kept in steps this long
const BACKGROUND_FOR = 0.03; // s: quiet for about this long, so a click or a dropout doesn't count
// It can't know the background before it has heard a gap: none of it shows for the first
// two seconds, then more of it over the next eight.
const BACKGROUND_AFTER = 2; // s
const BACKGROUND_OVER = 8;
// A sound this far above the background (dB) is shown as all voice, and one this near it as all
// background: a voice as loud as the background makes the two together 3 dB louder than it alone.
// Tried on four reciters with rooms and noise simulated: with these, a clear recitation's bars
// look mostly red one 2 s stretch in a hundred, and one with people talking 5 dB below it, four in ten.
const VOICE_ABOVE = 21;
const BACKGROUND_WITHIN = 3;
// A bar this short (of its height) or shorter is too faint for its background to matter: it fades to none.
const FAINT = 0.1;
// The voice, for the reading in the settings: the loudest all the bands together have been
// lately, which falls away this fast once they go quiet.
const VOICE_FALLS = 3; // dB a second
// The sound log, for the graph in the settings: a reading this often, for this long at the most.
const LOG_EVERY = 0.5; // s
const LOG_FOR = 60 * 60; // s
const MEASURE_EVERY = 100; // ms: how often it measures when nothing's drawing the meter
// Chrome on Android names a phone's microphones by how it routes the sound: "Speakerphone"
// and "Headset earpiece". Left on the default, the app takes the speakerphone's, the one
// for hearing a room, which suits a recitation playing from a speaker.
export const PREFERRED_MICROPHONE = 'Speakerphone';

export class Listener {
  /** Called when the audio source goes away (e.g. the user stops tab sharing). */
  onEnded = null;
  /** Called once each time the sound stops for a pause, with when it stopped (performance.now()). */
  onPause = null;
  /**
   * Returns true while what it hears is the app's own voice, reading the translation
   * through the speaker: then it doesn't measure the sound, or find pauses in it.
   */
  isDeaf = null;

  #stream = null;
  #ctx = null;
  #analyser = null;
  #freq = null;
  #meter = null;
  #bars = null; // the meter's last reading
  #measuredAt = -Infinity;
  #measuring = null; // the timer that measures when the page isn't asking
  #startedAt = 0;
  #log = []; // { at, voice, noise }: see soundLog
  #logging = null; // the reading being gathered for the log: { until, voice, noise }
  #ring = null;
  #written = 0;
  #lastChunkAt = 0;
  #loudest = 0; // RMS, fading
  #quiet = Infinity; // seconds since the last sound: none yet, so no pause to report
  #reciting = 0; // seconds of reciting heard since it started: sound, and the pauses in it shorter than STOP
  #sounds = []; // [start, end] (performance.now()) of each stretch of sound in the last RING_SECONDS

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

  /** Seconds of sound heard since `t` (performance.now()), not counting the app's own voice. */
  soundSince(t) {
    let seconds = 0;
    for (const [start, end] of this.#sounds) if (end > t) seconds += (end - Math.max(start, t)) / 1000;
    return seconds;
  }

  /**
   * @param {'mic' | 'tab'} source
   * @param {string} [microphone] a deviceId; one that's gone falls back to the default.
   *   '' is the default: PREFERRED_MICROPHONE where there's one.
   */
  async start(source, microphone = '') {
    if (!navigator.mediaDevices) {
      throw new Error('audio capture needs a secure page (https or localhost)');
    }
    // Voice processing is tuned for calls, and can strip a recitation out as echo or noise, so turn it all off.
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const open = (id) => navigator.mediaDevices.getUserMedia({ audio: id ? { ...audio, deviceId: { ideal: id } } : audio });
    let stream;
    if (source === 'tab') stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio, systemAudio: 'include' });
    else {
      const preferred = microphone ? null : await preferredMicrophone();
      stream = await open(microphone || preferred);
      // The first time, the microphones only get their names once it's allowed to use one
      const now = microphone || preferred ? null : await preferredMicrophone();
      if (now && stream.getAudioTracks()[0]?.getSettings().deviceId !== now) {
        stream.getTracks().forEach((track) => track.stop());
        stream = await open(now);
      }
    }

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
      this.#freq = new Float32Array(this.#analyser.frequencyBinCount);
      this.#meter = new Meter(METER_BARS); // a new one, with no memory of the last room
      this.#bars = null;
      this.#log = [];
      this.#logging = null;
      this.#startedAt = performance.now();
      input.connect(this.#analyser);

      this.#ring = new Float32Array(ctx.sampleRate * RING_SECONDS);
      this.#written = 0;
      this.#loudest = 0;
      this.#quiet = Infinity;
      this.#reciting = 0;
      this.#sounds = [];
      capture.port.onmessage = ({ data }) => this.#push(data);
      this.#stream = stream;
      this.#ctx = ctx;
      // The log and the reading in the settings go on with the meter hidden, or the page not drawing
      clearInterval(this.#measuring);
      this.#measuring = setInterval(() => performance.now() - this.#measuredAt >= MEASURE_EVERY && this.#measure(), MEASURE_EVERY);
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      throw err;
    }
  }

  stop() {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#ctx?.close();
    this.#stream = this.#ctx = this.#analyser = null;
    clearInterval(this.#measuring);
    this.#measuring = null;
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

  /**
   * What it hears now, in METER_BARS log-spaced bands (60 Hz – 8 kHz): each { level, noise }.
   * `level` is how loud, 0..1, and `noise` how much of that is the background rather than
   * a voice over it, 0..1 (see Meter).
   */
  levels() {
    if (!this.#analyser) return Array.from({ length: METER_BARS }, () => ({ level: 0, noise: 0 }));
    return this.#measure();
  }

  /**
   * How loud the voice and the background under it are now, in dB (of the loudest the
   * microphone can take, so both are below 0): { voice, noise }, or null when it isn't
   * listening, or hasn't for long enough to tell them apart. See Meter.
   */
  get sound() {
    return this.#analyser ? (this.#meter?.sound ?? null) : null;
  }

  /**
   * The sound since it last started listening, for a graph: every LOG_EVERY seconds,
   * { at, voice, noise }: seconds from the start, the loudest it got in that time, and the
   * background then (both dB). Kept after it stops, until it starts again. Without the
   * stretches where the app's own voice was reading aloud.
   */
  get soundLog() {
    return this.#log;
  }

  #measure() {
    const now = performance.now();
    this.#measuredAt = now;
    this.#analyser.getFloatFrequencyData(this.#freq);
    this.#bars = this.#meter.read(this.#freq, this.#ctx.sampleRate / this.#analyser.fftSize, now);
    const loudness = this.#meter.loudness;
    const sound = this.#meter.sound;
    if (loudness === null || this.isDeaf?.()) this.#logging = null;
    else {
      this.#logging ??= { until: now + LOG_EVERY * 1000, voice: -Infinity };
      this.#logging.voice = Math.max(this.#logging.voice, loudness);
      if (now >= this.#logging.until) {
        this.#log.push({ at: (now - this.#startedAt) / 1000, voice: this.#logging.voice, noise: sound?.noise ?? null });
        if (this.#log.length > LOG_FOR / LOG_EVERY) this.#log.shift();
        this.#logging = null;
      }
    }
    return this.#bars;
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
    if (this.isDeaf?.()) {
      // The voice, over whatever else there is: the reciter is taken to carry on meanwhile
      this.#reciting += seconds;
      this.#quiet = 0;
      return;
    }
    this.#loudest = Math.max(rms, this.#loudest * Math.exp(-seconds / LOUDEST_MEMORY));
    if (rms > SILENCE_RMS && rms >= this.#loudest * PAUSE_LEVEL) {
      if (this.#quiet < STOP) this.#reciting += this.#quiet; // a pause, not a stop
      this.#reciting += seconds;
      this.#quiet = 0;
      this.#heardSound(this.#lastChunkAt - seconds * 1000, this.#lastChunkAt);
      return;
    }
    const before = this.#quiet;
    this.#quiet += seconds;
    if (before < PAUSE && this.#quiet >= PAUSE) this.onPause?.(this.#lastChunkAt - this.#quiet * 1000);
  }

  #heardSound(start, end) {
    const sounds = this.#sounds;
    const last = sounds.at(-1);
    if (last && start - last[1] < 100) last[1] = end;
    else sounds.push([start, end]);
    while (sounds.length && sounds[0][1] < end - RING_SECONDS * 1000) sounds.shift();
  }
}

/**
 * Turns the analyser's readings into the meter's bars, telling a voice from the background
 * under it. The background is the quietest each band has been in the last BACKGROUND_MEMORY
 * seconds: a voice has gaps, and what fills them is the room. That's its noise, and its echo
 * too, where it rings for long enough to fill the gaps. A sound VOICE_ABOVE dB over the
 * background is all voice; nearer it than that, part of the bar is the background's.
 */
export class Meter {
  #bands;
  #at = null; // when it last read (ms)
  #heard = 0; // seconds of readings since the sound began
  #loudness = null; // all the bands together, now (dB)
  #voice = -Infinity; // the loudest that's been lately
  #noise = null; // and their backgrounds together

  constructor(count) {
    this.count = count;
    // smooth: the band's loudness (dB) over the last BACKGROUND_FOR; quietest: its least in this step, and in each step before
    this.#bands = Array.from({ length: count }, () => ({ smooth: null, quietest: Infinity, before: [], since: 0 }));
  }

  /**
   * @param {Float32Array} db the analyser's getFloatFrequencyData(): dB in each frequency bin
   * @param {number} hzPerBin
   * @param {number} now ms
   * @returns {{ level: number, noise: number }[]} for each bar, how tall (0..1), and how much of it is background (0..1)
   */
  read(db, hzPerBin, now) {
    const count = this.count;
    const seconds = this.#at === null ? 0 : Math.min(1, Math.max(0, (now - this.#at) / 1000));
    this.#at = now;
    let sound = false;
    const heard = this.#bands.map((band, i) => {
      const lo = Math.floor((METER_FROM * (METER_TO / METER_FROM) ** (i / count)) / hzPerBin);
      const hi = Math.min(Math.ceil((METER_FROM * (METER_TO / METER_FROM) ** ((i + 1) / count)) / hzPerBin), db.length - 1);
      let max = -Infinity;
      let power = 0;
      for (let bin = lo; bin <= hi; bin++) {
        max = Math.max(max, db[bin]);
        power += 10 ** (db[bin] / 10);
      }
      if (power > 0) sound = true;
      return { max, loudness: Math.max(-140, 10 * Math.log10(power)) };
    });
    // Before the first sound arrives (and while a shared tab plays nothing) there's no room to measure
    if (!sound) return heard.map(() => ({ level: 0, noise: 0 }));
    this.#heard += seconds;

    let all = 0; // power, over every band
    let under = 0; // and of their backgrounds
    const bars = heard.map(({ max, loudness }, i) => {
      const band = this.#bands[i];
      band.smooth = band.smooth === null ? loudness : band.smooth + (loudness - band.smooth) * (1 - Math.exp(-seconds / BACKGROUND_FOR));
      band.quietest = Math.min(band.quietest, band.smooth);
      band.since += seconds;
      const background = Math.min(band.quietest, ...band.before);
      all += 10 ** (band.smooth / 10);
      under += 10 ** (background / 10);
      if (band.since >= BACKGROUND_STEP) {
        band.before.push(band.quietest);
        if (band.before.length >= BACKGROUND_MEMORY / BACKGROUND_STEP) band.before.shift();
        band.quietest = band.smooth;
        band.since = 0;
      }
      const level = clamp((max - METER_QUIET) / (METER_LOUD - METER_QUIET));
      // Not before it has heard a gap, nor for a bar too faint to see
      const known = clamp((this.#heard - BACKGROUND_AFTER) / BACKGROUND_OVER) * clamp(level / FAINT);
      return { level, noise: known * clamp((VOICE_ABOVE - (loudness - background)) / (VOICE_ABOVE - BACKGROUND_WITHIN)) };
    });
    this.#loudness = 10 * Math.log10(all);
    this.#voice = Math.max(this.#loudness, this.#voice - VOICE_FALLS * seconds);
    this.#noise = 10 * Math.log10(under);
    return bars;
  }

  /** All the bands together, now (dB), or null before any sound. */
  get loudness() {
    return this.#loudness;
  }

  /**
   * { voice, noise } in dB: the loudest all the bands together have been lately, and their
   * backgrounds together. Null until it has listened long enough to have heard a gap.
   */
  get sound() {
    if (this.#noise === null || this.#heard < BACKGROUND_AFTER) return null;
    return { voice: this.#voice, noise: this.#noise };
  }
}

const clamp = (x) => Math.max(0, Math.min(1, x));

/** The deviceId of the PREFERRED_MICROPHONE, if there's one (and it has its name yet). */
async function preferredMicrophone() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.find((d) => d.kind === 'audioinput' && d.label === PREFERRED_MICROPHONE)?.deviceId ?? null;
  } catch {
    return null;
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
