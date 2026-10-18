package io.github.fardanrashidi.quranwhisperer;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Finds where in the Quran a transcribed snippet of recitation comes from, for
 * AutoSearchService, which runs without the page. A port of locate() in
 * lib/quran.js: keep the two in step (the same rules and numbers, and the same
 * order for ties, so they give the same answers).
 */
final class QuranSearch {

    private static final int MIN_WORDS = 3; // shorter transcripts are too ambiguous to place
    // ...except just after `near`, where two words are plenty to go on.
    private static final int MIN_WORDS_CLOSE = 2;
    private static final int CLOSE_AHEAD = 20;
    private static final int CANDIDATES = 8; // alignments to score in detail
    private static final int NEAR_BEHIND = 30; // words: how far back from the last position still counts as "continuing"
    private static final int NEAR_AHEAD = 400;
    private static final double NEAR_BONUS = 2.5; // enough to break a tie between identical passages
    private static final double NEAR_DISTANCE_COST = 0.002; // per word away from `near`, so the closer copy wins
    private static final int NEAR_CANDIDATES = 3; // extra alignments kept for the best regions that continue from `near`
    private static final double AMBIGUITY_MARGIN = 2; // about one word's worth
    private static final double GAP = -0.8;

    static final class Surah {
        final int number;
        final String name; // Arabic, e.g. سُورَةُ يسٓ
        final String englishName; // e.g. Yaseen
        final List<String> ayahs;

        Surah(int number, String name, String englishName, List<String> ayahs) {
            this.number = number;
            this.name = name;
            this.englishName = englishName;
            this.ayahs = ayahs;
        }
    }

    /** As locate() returns it; see lib/quran.js. */
    static final class Match {
        final int surah, ayah, word, ayahEnd;
        final double score;
        final boolean ambiguous, continues;

        Match(int surah, int ayah, int word, int ayahEnd, double score, boolean ambiguous, boolean continues) {
            this.surah = surah;
            this.ayah = ayah;
            this.word = word;
            this.ayahEnd = ayahEnd;
            this.score = score;
            this.ambiguous = ambiguous;
            this.continues = continues;
        }
    }

    private final List<Surah> surahs;
    private final String[] words; // every word of the Quran, normalised
    private final int[] wordAyah; // word index → global ayah index
    private final int[][] ayahRef; // global ayah index → { surah, ayah }
    private final int[] ayahFirstWord; // global ayah index → its first word index
    private final boolean[] basmala; // words that belong to a Basmala (1:1 and inside 27:30)
    private final Map<String, int[]> positions = new HashMap<>();

    /** @param surahs quran-simple-clean (lib/quran.js's MATCH_EDITION), all 114 in order */
    QuranSearch(List<Surah> surahs) {
        this.surahs = surahs;
        List<String> words = new ArrayList<>();
        List<Integer> wordAyah = new ArrayList<>();
        List<int[]> ayahRef = new ArrayList<>();
        List<Integer> ayahFirstWord = new ArrayList<>();
        for (Surah s : surahs) {
            for (int i = 0; i < s.ayahs.size(); i++) {
                ayahRef.add(new int[] { s.number, i + 1 });
                ayahFirstWord.add(words.size());
                String text = s.ayahs.get(i);
                for (String w : normalize(i == 0 && s.number != 1 ? stripBasmala(text) : text)) {
                    words.add(w);
                    wordAyah.add(ayahRef.size() - 1);
                }
            }
        }
        this.words = words.toArray(new String[0]);
        this.wordAyah = wordAyah.stream().mapToInt(Integer::intValue).toArray();
        this.ayahRef = ayahRef.toArray(new int[0][]);
        this.ayahFirstWord = ayahFirstWord.stream().mapToInt(Integer::intValue).toArray();

        basmala = new boolean[this.words.length];
        for (int i = 0; i + 4 <= this.words.length; i++) {
            if (join(Arrays.asList(this.words).subList(i, i + 4)).equals(BASMALA)) {
                for (int k = i; k < i + 4; k++) basmala[k] = true;
            }
        }
        Map<String, List<Integer>> lists = new HashMap<>();
        for (int i = 0; i < this.words.length; i++) lists.computeIfAbsent(this.words[i], w -> new ArrayList<>()).add(i);
        for (Map.Entry<String, List<Integer>> e : lists.entrySet()) {
            positions.put(e.getKey(), e.getValue().stream().mapToInt(Integer::intValue).toArray());
        }
    }

    /** The surah with this number (1–114). */
    Surah surah(int number) {
        return surahs.get(number - 1);
    }

    /**
     * @param near the global index of the last word heard, to prefer carrying on from there, or null
     * @return null when it isn't (enough of) the Quran
     */
    Match locate(String transcript, Integer near) {
        List<String> t = normalize(transcript);
        if (t.size() < (near == null ? MIN_WORDS : MIN_WORDS_CLOSE)) return null;

        List<Alignment> ranked = new ArrayList<>();
        for (int start : candidateRegions(t, near)) {
            Alignment m = align(t, start - 3, start + t.size() + 3);
            if (m == null) continue;
            m.rank = m.score + (continues(m.end, near) ? NEAR_BONUS - NEAR_DISTANCE_COST * Math.abs(m.end - near) : 0);
            ranked.add(m);
        }
        ranked.sort((a, b) -> descending(a.rank, b.rank));
        if (ranked.isEmpty()) return null;
        Alignment best = ranked.get(0);

        // Most of the transcript has to line up, or it's noise (or not the Quran).
        boolean close = near != null && best.end >= near && best.end <= near + CLOSE_AHEAD;
        if (best.matched.size() < (close ? MIN_WORDS_CLOSE : MIN_WORDS) || best.matched.size() < t.size() * 0.5) return null;
        // The Basmala on its own begins nearly every surah, so it says nothing about where we are.
        boolean onlyBasmala = true;
        for (int w : best.matched) onlyBasmala &= basmala[w];
        if (onlyBasmala) return null;

        Alignment runnerUp = null;
        for (Alignment m : ranked) {
            if (Math.abs(m.end - best.end) > t.size()) {
                runnerUp = m;
                break;
            }
        }
        boolean ambiguous = runnerUp != null && best.rank - runnerUp.rank < AMBIGUITY_MARGIN;
        int ayahIndex = wordAyah[best.end];
        int ayahEnd = (ayahIndex + 1 < ayahFirstWord.length ? ayahFirstWord[ayahIndex + 1] : words.length) - 1;
        return new Match(
            ayahRef[ayahIndex][0],
            ayahRef[ayahIndex][1],
            best.end,
            ayahEnd,
            Math.round(best.score * 10) / 10.0,
            ambiguous,
            continues(best.end, near)
        );
    }

    private static boolean continues(int end, Integer near) {
        return near != null && end >= near - NEAR_BEHIND && end <= near + NEAR_AHEAD;
    }

    // JavaScript's (a, b) => b - a, for a stable sort that breaks ties the same way.
    private static int descending(double a, double b) {
        double d = b - a;
        return d > 0 ? 1 : d < 0 ? -1 : 0;
    }

    // --- candidates and alignment ----------------------------------------------

    // Each word that matches exactly votes for where the transcript would start;
    // rare words count for more. The busiest start positions are the candidates.
    private List<Integer> candidateRegions(List<String> t, Integer near) {
        Map<Integer, Double> votes = new LinkedHashMap<>(); // in insertion order, like a JavaScript Map
        for (int j = 0; j < t.size(); j++) {
            int[] hits = positions.get(t.get(j));
            if (hits == null) continue;
            double weight = StrictMath.log((double) words.length / hits.length);
            for (int p : hits) votes.merge(p - j, weight, Double::sum);
        }

        // Recognition errors add or drop words, so pool votes over nearby starts.
        List<double[]> pooled = new ArrayList<>(); // { start, votes }
        for (int d : votes.keySet()) {
            double sum = 0;
            for (int k = d - 3; k <= d + 3; k++) sum += votes.getOrDefault(k, 0.0);
            pooled.add(new double[] { d, sum });
        }
        pooled.sort((a, b) -> descending(a[1], b[1]));

        List<Integer> regions = new ArrayList<>();
        addRegions(regions, pooled, CANDIDATES, t.size());
        // A passage that's in many places (a refrain) can fill every slot with copies
        // from elsewhere, so also take the best ones that would continue from `near`,
        // the closest first.
        if (near != null) {
            List<double[]> nearby = new ArrayList<>();
            for (double[] p : pooled) {
                int end = (int) p[0] + t.size() - 1;
                if (end >= near - NEAR_BEHIND && end <= near + NEAR_AHEAD) nearby.add(p);
            }
            nearby.sort((a, b) -> {
                int byVotes = descending(a[1], b[1]);
                if (byVotes != 0) return byVotes;
                return Math.abs((int) a[0] + t.size() - 1 - near) - Math.abs((int) b[0] + t.size() - 1 - near);
            });
            addRegions(regions, nearby, NEAR_CANDIDATES, t.size());
        }
        return regions;
    }

    private static void addRegions(List<Integer> regions, List<double[]> list, int limit, int length) {
        int added = 0;
        for (double[] p : list) {
            if (added == limit) break;
            int d = (int) p[0];
            boolean apart = true;
            for (int r : regions) apart &= Math.abs(r - d) > length;
            if (apart) {
                regions.add(d);
                added++;
            }
        }
    }

    private static final class Alignment {
        final double score;
        final List<Integer> matched; // Quran word indices that lined up
        final int end;
        double rank;

        Alignment(double score, List<Integer> matched) {
            this.score = score;
            this.matched = matched;
            int end = matched.get(0);
            for (int w : matched) end = Math.max(end, w);
            this.end = end;
        }
    }

    // Smith-Waterman local alignment of the transcript against words[from, to),
    // with partial credit for near-miss spellings.
    private Alignment align(List<String> t, int from, int to) {
        from = Math.max(0, from);
        to = Math.min(words.length, to);
        int m = t.size();
        int n = to - from;
        if (n <= 0) return null;

        double[] h = new double[(m + 1) * (n + 1)];
        double bestScore = 0;
        int bestCell = 0;
        for (int i = 1; i <= m; i++) {
            for (int j = 1; j <= n; j++) {
                double cell = Math.max(
                    Math.max(0, h[(i - 1) * (n + 1) + j - 1] + wordScore(t.get(i - 1), words[from + j - 1])),
                    Math.max(h[(i - 1) * (n + 1) + j] + GAP, h[i * (n + 1) + j - 1] + GAP)
                );
                h[i * (n + 1) + j] = cell;
                if (cell > bestScore) {
                    bestScore = cell;
                    bestCell = i * (n + 1) + j;
                }
            }
        }
        if (bestScore == 0) return null;

        // Walk back to collect which Quran words lined up.
        List<Integer> matched = new ArrayList<>();
        int i = bestCell / (n + 1);
        int j = bestCell % (n + 1);
        while (i > 0 && j > 0 && h[i * (n + 1) + j] > 0) {
            double s = wordScore(t.get(i - 1), words[from + j - 1]);
            if (h[i * (n + 1) + j] == h[(i - 1) * (n + 1) + j - 1] + s) {
                if (s > 0) matched.add(from + j - 1);
                i--;
                j--;
            } else if (h[i * (n + 1) + j] == h[(i - 1) * (n + 1) + j] + GAP) {
                i--;
            } else {
                j--;
            }
        }
        return matched.isEmpty() ? null : new Alignment(bestScore, matched);
    }

    private static double wordScore(String a, String b) {
        if (a.equals(b)) return 2;
        double similarity = 1 - (double) levenshtein(a, b) / Math.max(a.length(), b.length());
        return similarity >= 0.6 ? 2 * similarity - 0.4 : -1;
    }

    private static int levenshtein(String a, String b) {
        int[] prev = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            int[] cur = new int[b.length() + 1];
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                cur[j] = Math.min(Math.min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + (a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1));
            }
            prev = cur;
        }
        return prev[b.length()];
    }

    // --- text ------------------------------------------------------------------

    // The same character classes as normalizeArabic() in lib/quran.js. JavaScript's
    // \s covers Unicode spaces, Java's only ASCII ones, so they're spelled out.
    private static final Pattern DIACRITICS = Pattern.compile("[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED\\u0640]");
    private static final Pattern ALIF = Pattern.compile("[\\u0623\\u0625\\u0622\\u0671]");
    private static final String SPACE = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF";
    private static final Pattern NOT_LETTER = Pattern.compile("[^\\u0621-\\u064A" + SPACE + "]");
    private static final Pattern SPACES = Pattern.compile("[" + SPACE + "]+");
    private static final String BASMALA = "بسم الله الرحمن الرحيم";

    /** Arabic text → comparable words: no vowel marks, one spelling per letter family. */
    static List<String> normalize(String text) {
        String s = DIACRITICS.matcher(text).replaceAll("");
        s = ALIF.matcher(s).replaceAll("ا")
            .replace('ى', 'ي') // ى → ي
            .replace('ة', 'ه') // ة → ه
            .replace('ؤ', 'و') // ؤ → و
            .replace('ئ', 'ي') // ئ → ي
            .replace("ء", ""); // ء
        s = NOT_LETTER.matcher(s).replaceAll(" ");
        List<String> out = new ArrayList<>();
        for (String w : SPACES.split(s)) if (!w.isEmpty()) out.add(w);
        return out;
    }

    // alquran.cloud prefixes the first verse of each surah with the Basmala.
    private static String stripBasmala(String text) {
        String[] tokens = text.split(" ", -1);
        String first = join(Arrays.asList(tokens).subList(0, Math.min(4, tokens.length)));
        if (!join(normalize(first)).equals(BASMALA)) return text;
        return join(Arrays.asList(tokens).subList(Math.min(4, tokens.length), tokens.length));
    }

    // String.join, which Android only has from 8.0
    private static String join(List<String> words) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < words.size(); i++) {
            if (i > 0) out.append(' ');
            out.append(words.get(i));
        }
        return out.toString();
    }
}
