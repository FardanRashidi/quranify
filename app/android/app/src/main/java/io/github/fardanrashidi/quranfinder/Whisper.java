package io.github.fardanrashidi.quranfinder;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Quran speech model (YunusZJ/whisper-base-ar-quran-ONNX) run with ONNX Runtime, which can use
 * several CPU cores; in the WebView it only gets one. This does what transformers.js does for the
 * server, so the transcripts are the same: Whisper's log-mel features, then greedy decoding in Arabic
 * with the model's suppressed tokens.
 */
final class Whisper implements AutoCloseable {

    /** The model's files, relative to its folder on Hugging Face: 8-bit encoder, 4-bit decoder. */
    static final String[] FILES = { "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_q4.onnx", "vocab.json" };

    // From the model's generation_config.json
    private static final long[] PROMPT = { 50258, 50272, 50359, 50363 }; // <|startoftranscript|> <|ar|> <|transcribe|> <|notimestamps|>
    private static final int END = 50257; // <|endoftext|>, also the first of the special tokens
    private static final int MAX_LENGTH = 448;
    private static final int[] SUPPRESS = {
        1, 2, 7, 8, 9, 10, 14, 25, 26, 27, 28, 29, 31, 58, 59, 60, 61, 62, 63, 90, 91, 92, 93, 359, 503, 522, 542, 873,
        893, 902, 918, 922, 931, 1350, 1853, 1982, 2460, 2627, 3246, 3253, 3268, 3536, 3846, 3961, 4183, 4667, 6585, 6647,
        7273, 9061, 9383, 10428, 10929, 11938, 12033, 12331, 12562, 13793, 14157, 14635, 15265, 15618, 16553, 16604, 18362,
        18956, 20075, 21675, 22520, 26130, 26161, 26435, 28279, 29464, 31650, 32302, 32470, 36865, 42863, 47425, 49870,
        50254, 50258, 50358, 50359, 50360, 50361, 50362,
    };
    private static final int[] SUPPRESS_FIRST = { 220, END }; // a space or nothing at all

    // From config.json and preprocessor_config.json
    private static final int LAYERS = 6, HEADS = 8, HEAD_SIZE = 64;
    private static final int SAMPLE_RATE = 16000, SAMPLES = 30 * SAMPLE_RATE, N_FFT = 400, HOP = 160, FRAMES = 3000, MELS = 80;
    private static final int BINS = N_FFT / 2 + 1;

    private final OrtEnvironment env = OrtEnvironment.getEnvironment();
    private final OrtSession encoder;
    private final OrtSession decoder;
    private final byte[][] tokens; // the UTF-8 bytes of each text token

    Whisper(File dir, int threads) throws OrtException, IOException, JSONException {
        OrtSession.SessionOptions options = new OrtSession.SessionOptions();
        options.setIntraOpNumThreads(threads);
        encoder = env.createSession(new File(dir, FILES[0]).getPath(), options);
        decoder = env.createSession(new File(dir, FILES[1]).getPath(), options);
        tokens = readVocab(new File(dir, FILES[2]));
    }

    /** @param audio 16 kHz mono, up to 30 s */
    String transcribe(float[] audio) throws OrtException {
        float[] features = logMel(audio);
        try (
            OnnxTensor input = OnnxTensor.createTensor(env, FloatBuffer.wrap(features), new long[] { 1, MELS, FRAMES });
            OrtSession.Result encoded = encoder.run(singleton("input_features", input))
        ) {
            return text(decode((OnnxTensor) encoded.get(0)));
        }
    }

    @Override
    public void close() throws OrtException {
        encoder.close();
        decoder.close();
    }

    // Decoding

    /** Picks the likeliest next token until the model says it's done. */
    private List<Integer> decode(OnnxTensor encoded) throws OrtException {
        List<Integer> out = new ArrayList<>();
        OrtSession.Result first = null; // keeps the cross-attention cache, which stays the same after the first step
        OrtSession.Result last = null; // keeps the self-attention cache
        List<OnnxTensor> inputs = new ArrayList<>();
        try {
            long[] ids = PROMPT;
            while (true) {
                Map<String, OnnxTensor> feed = new HashMap<>();
                feed.put("input_ids", track(inputs, OnnxTensor.createTensor(env, LongBuffer.wrap(ids), new long[] { 1, ids.length })));
                feed.put("encoder_hidden_states", encoded);
                feed.put("use_cache_branch", track(inputs, OnnxTensor.createTensor(env, new boolean[] { last != null })));
                OnnxTensor empty = last == null ? track(inputs, OnnxTensor.createTensor(env, FloatBuffer.allocate(0), new long[] { 1, HEADS, 0, HEAD_SIZE })) : null;
                for (int i = 0; i < LAYERS; i++) {
                    for (String kind : new String[] { "decoder", "encoder" }) {
                        for (String part : new String[] { "key", "value" }) {
                            String name = i + "." + kind + "." + part;
                            OrtSession.Result from = kind.equals("decoder") ? last : first;
                            feed.put("past_key_values." + name, from == null ? empty : (OnnxTensor) from.get("present." + name).get());
                        }
                    }
                }
                OrtSession.Result result = decoder.run(feed);
                for (OnnxTensor tensor : inputs) tensor.close();
                inputs.clear();
                if (last != first) last.close();
                if (first == null) first = result;
                last = result;

                int next = argmax((OnnxTensor) result.get("logits").get(), out.isEmpty());
                out.add(next);
                if (next == END || PROMPT.length + out.size() >= MAX_LENGTH) return out;
                ids = new long[] { next };
            }
        } finally {
            for (OnnxTensor tensor : inputs) tensor.close();
            if (last != null && last != first) last.close();
            if (first != null) first.close();
        }
    }

    private static int argmax(OnnxTensor logits, boolean firstToken) {
        long[] shape = logits.getInfo().getShape(); // [1, tokens in, vocabulary]
        int size = (int) shape[2];
        FloatBuffer all = logits.getFloatBuffer();
        float[] scores = new float[size];
        all.position((int) (shape[1] - 1) * size);
        all.get(scores);
        for (int id : SUPPRESS) scores[id] = Float.NEGATIVE_INFINITY;
        if (firstToken) for (int id : SUPPRESS_FIRST) scores[id] = Float.NEGATIVE_INFINITY;
        int best = 0;
        for (int i = 1; i < size; i++) if (scores[i] > scores[best]) best = i;
        return best;
    }

    private static <T extends AutoCloseable> T track(List<? super T> list, T value) {
        list.add(value);
        return value;
    }

    private static Map<String, OnnxTensor> singleton(String name, OnnxTensor tensor) {
        Map<String, OnnxTensor> map = new HashMap<>();
        map.put(name, tensor);
        return map;
    }

    // Tokens to text

    /** Joins the text tokens, leaving out special ones and timestamps. */
    private String text(List<Integer> ids) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int id : ids) if (id < END) bytes.write(tokens[id], 0, tokens[id].length);
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }

    /** vocab.json spells each token's bytes with GPT-2's byte-to-character table. */
    private static byte[][] readVocab(File file) throws IOException, JSONException {
        byte[] json = new byte[(int) file.length()];
        try (DataInputStream in = new DataInputStream(new FileInputStream(file))) {
            in.readFully(json);
        }
        JSONObject vocab = new JSONObject(new String(json, StandardCharsets.UTF_8));

        int[] byteOf = new int[512];
        int unprintable = 0;
        for (int b = 0; b < 256; b++) {
            boolean printable = (b >= '!' && b <= '~') || (b >= 0xA1 && b <= 0xAC) || b >= 0xAE;
            byteOf[printable ? b : 256 + unprintable++] = b;
        }

        byte[][] tokens = new byte[END][];
        for (Iterator<String> it = vocab.keys(); it.hasNext(); ) {
            String token = it.next();
            int id = vocab.getInt(token);
            if (id >= END) continue;
            byte[] spelled = new byte[token.length()];
            for (int i = 0; i < spelled.length; i++) spelled[i] = (byte) byteOf[token.charAt(i)];
            tokens[id] = spelled;
        }
        for (int id = 0; id < END; id++) if (tokens[id] == null) tokens[id] = new byte[0];
        return tokens;
    }

    // Log-mel features, as transformers.js computes them for Whisper (WhisperFeatureExtractor)

    private static final double[] COS = new double[N_FFT], SIN = new double[N_FFT], WINDOW = new double[N_FFT];
    private static final float[][] FILTERS = new float[MELS][BINS];

    static {
        for (int i = 0; i < N_FFT; i++) {
            COS[i] = Math.cos(2 * Math.PI * i / N_FFT);
            SIN[i] = Math.sin(2 * Math.PI * i / N_FFT);
            WINDOW[i] = 0.5 - 0.5 * Math.cos(i * (2 * Math.PI / N_FFT)); // periodic Hann
        }
        // Triangular filters from 0 to 8 kHz on the Slaney mel scale, each scaled to the same area
        double melMin = hertzToMel(0), melMax = hertzToMel(SAMPLE_RATE / 2.0);
        double[] edges = new double[MELS + 2];
        for (int i = 0; i < edges.length; i++) edges[i] = melToHertz(melMin + (melMax - melMin) / (MELS + 1) * i);
        for (int m = 0; m < MELS; m++) {
            double area = 2.0 / (edges[m + 2] - edges[m]);
            for (int b = 0; b < BINS; b++) {
                double freq = (SAMPLE_RATE / 2.0) / (BINS - 1) * b;
                double rising = (freq - edges[m]) / (edges[m + 1] - edges[m]);
                double falling = (edges[m + 2] - freq) / (edges[m + 2] - edges[m + 1]);
                FILTERS[m][b] = (float) (Math.max(0, Math.min(rising, falling)) * area);
            }
        }
    }

    private static double hertzToMel(double hz) {
        return hz >= 1000 ? 15 + Math.log(hz / 1000) * (27 / Math.log(6.4)) : 3 * hz / 200;
    }

    private static double melToHertz(double mel) {
        return mel >= 15 ? 1000 * Math.exp(Math.log(6.4) / 27 * (mel - 15)) : 200 * mel / 3;
    }

    /** An 80 × 3000 log-mel spectrogram of the audio padded with silence to 30 s. */
    static float[] logMel(float[] audio) {
        int length = Math.min(audio.length, SAMPLES);
        int pad = N_FFT / 2; // frames are centred on their hop, with the ends mirrored
        double[] wave = new double[SAMPLES + 2 * pad];
        for (int i = 0; i < length; i++) wave[pad + i] = audio[i];
        for (int i = 1; i <= pad; i++) {
            wave[pad - i] = wave[pad + i];
            wave[pad + SAMPLES - 1 + i] = wave[pad + SAMPLES - 1 - i];
        }

        // Frames past the end of the audio are silent, so skip their transforms
        int frames = Math.min(FRAMES, (length + pad + HOP - 1) / HOP);
        float[][] power = new float[frames][BINS];
        double[] frame = new double[N_FFT], re = new double[N_FFT], im = new double[N_FFT];
        double[] scratchRe = new double[N_FFT], scratchIm = new double[N_FFT];
        for (int f = 0; f < frames; f++) {
            for (int i = 0; i < N_FFT; i++) frame[i] = wave[f * HOP + i] * WINDOW[i];
            fft(frame, 0, 1, N_FFT, re, im, 0, scratchRe, scratchIm);
            for (int b = 0; b < BINS; b++) power[f][b] = (float) (re[b] * re[b] + im[b] * im[b]);
        }

        float[] mel = new float[MELS * FRAMES];
        float top = Float.NEGATIVE_INFINITY;
        for (int m = 0; m < MELS; m++) {
            for (int f = 0; f < FRAMES; f++) {
                double sum = 0;
                if (f < frames) for (int b = 0; b < BINS; b++) sum += FILTERS[m][b] * power[f][b];
                float value = (float) Math.log10(Math.max(1e-10f, (float) sum));
                mel[m * FRAMES + f] = value;
                top = Math.max(top, value);
            }
        }
        for (int i = 0; i < mel.length; i++) mel[i] = (float) ((Math.max(mel[i], top - 8.0) + 4.0) / 4.0);
        return mel;
    }

    /**
     * Fourier transform of the n real values x[off], x[off + stride], … into (re, im)[out…], splitting
     * n by its smallest factor each time (400 = 2·2·2·2·5·5).
     */
    private static void fft(double[] x, int off, int stride, int n, double[] re, double[] im, int out, double[] tRe, double[] tIm) {
        if (n == 1) {
            re[out] = x[off];
            im[out] = 0;
            return;
        }
        int p = 2;
        while (n % p != 0) p++;
        int m = n / p;
        for (int q = 0; q < p; q++) fft(x, off + q * stride, stride * p, m, re, im, out + q * m, tRe, tIm);
        int step = N_FFT / n; // e^(-2πi k/n) is COS/SIN at k·step
        for (int k = 0; k < m; k++) {
            for (int q = 0; q < p; q++) {
                int at = out + q * m + k, t = q * k * step % N_FFT;
                tRe[q] = re[at] * COS[t] + im[at] * SIN[t];
                tIm[q] = im[at] * COS[t] - re[at] * SIN[t];
            }
            for (int s = 0; s < p; s++) {
                double sumRe = 0, sumIm = 0;
                for (int q = 0; q < p; q++) {
                    int t = q * s % p * (N_FFT / p);
                    sumRe += tRe[q] * COS[t] + tIm[q] * SIN[t];
                    sumIm += tIm[q] * COS[t] - tRe[q] * SIN[t];
                }
                re[out + k + s * m] = sumRe;
                im[out + k + s * m] = sumIm;
            }
        }
    }
}
