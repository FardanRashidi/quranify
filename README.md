# sound-finder

A web app that listens to whatever is playing around you and tells you what it is.

- **Music mode** identifies the song and shows its lyrics in time with it, with
  the current line highlighted, in a dark terminal style.
- **Quran mode** recognises a recitation, works out the surah and ayah, and shows
  the verses with an English or Malay translation for you to follow along.

It runs as a small Node server on your computer (or on Home Assistant). Any phone,
tablet or computer on your network opens it in the browser and uses its own
microphone. There is also an [Android app](#android-app) that does everything
on the phone, with no server.

## Contents

- [Quick start](#quick-start)
- [Using it](#using-it)
- [How it fits together](#how-it-fits-together)
- [Audio capture](#audio-capture)
- [Music mode in detail](#music-mode-in-detail)
- [Quran mode in detail](#quran-mode-in-detail)
- [The server](#the-server)
- [What leaves your machine](#what-leaves-your-machine)
- [Home Assistant add-on](#home-assistant-add-on)
- [Android app](#android-app)
- [Performance](#performance)
- [Project layout](#project-layout)
- [Limitations](#limitations)
- [Before turning this into a real app](#before-turning-this-into-a-real-app)
- [Credits and licences](#credits-and-licences)

## Quick start

You need Node 20 or newer, `openssl` (to make the https certificate), and an
internet connection.

```sh
git clone https://github.com/FardanRashidi/sound-finder.git
cd sound-finder
npm install
npm start        # → http://localhost:3000   (npm run dev restarts on changes)
```

Open <http://localhost:3000>, press **Listen**, allow the microphone, and play
some music.

### From your phone or another computer

Open the `https://<your-ip>:3000` address the server prints when it starts.
Plain `http://` redirects there. Browsers only allow the microphone on https
pages (or on localhost), so the server makes its own certificate the first time
it runs. Each device shows a warning once:

- **Chrome:** *Advanced → Proceed*
- **Safari:** *Show Details → visit this website*
- **Firefox:** *Accept the Risk and Continue*

If the device still can't connect, check your firewall. For example, with ufw:
`sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp`.

### On Home Assistant

The [`homeassistant/`](homeassistant/) folder is a Home Assistant add-on, which
needs Home Assistant OS or Supervised. See
[Home Assistant add-on](#home-assistant-add-on).

## Using it

The top bar has a mode switch (**Music** / **Quran**), the audio source, the
[settings](#settings) button, and the listen button. A live level meter shows
what the app hears. The footer shows the status, a timing or ayah control, and
(in Quran mode) the translation.

### Music mode

1. Press **Listen** (or Space). After about 4 seconds of audio it makes its first
   attempt, and a song is usually identified about 5 seconds after you press
   Listen.
2. You get the cover art, title, artist, album and year, a progress bar, and the
   lyrics. The interface takes its colours from the album art (unless that's
   turned off in settings).
3. The lyrics scroll with the song. The current line is bright, past lines fade,
   and an intro longer than 3 seconds gets a `♪` line. If you scroll yourself,
   auto-scroll pauses for 4 seconds.
4. **Dimmed lyrics** mean "not sure yet". This happens when the match came from
   a short clip (it re-checks after 3 seconds) or when listening is stopped.
5. **Sync** (or `S`) identifies again right now, from audio already heard. Use
   it if the lyrics feel off.
6. **lyrics − / +** (or `[` `]`) shifts the lyrics 0.25 s later or sooner, if a
   song's lyric timings are slightly off. The app remembers this setting.
7. When the song stops (4 seconds of silence), changes, or ends, the screen
   clears and it starts listening for the next one.

The timings above are the defaults; they can be changed in settings.

If a song has no synced lyrics, the plain lyrics are shown without
highlighting. Instrumentals show `♪ instrumental ♪`.

### Quran mode

1. Switch to **Quran**. The server starts loading its speech model straight
   away. The first time ever, it downloads about 400 MB, which takes a minute.
2. Press **Listen & sync** and play a recitation. It listens until it knows
   where the reciter is. Then it shows the surah, highlights the ayah, and turns
   the microphone off.
3. Move through the verses yourself with **ayah − / +** in the footer, `[` `]`,
   the arrow keys, or by tapping a verse.
4. Lost your place, or did the reciter jump? Press **sync** next to the ayah
   buttons (or **Listen & sync** again). The surah stays on screen while it
   listens, and it prefers matches that continue from where you are.

Some phrases appear word for word in more than one place in the Quran. If what
it heard could be either, it shows its best guess dimmed and keeps listening
until the reciter says something that settles it. It gives up after 60 seconds
without a match.

Translations: **English** (Saheeh International), **Melayu** (Abdullah Muhammad
Basmeih), or **None**.

The verses are shown in the Uthmani text and font of the King Fahd Complex
(KFGQPC), the same as the Madinah mushaf, with each ayah number in an end-of-ayah
sign. They are coloured the way Malaysian tajweed mushafs colour them:

- red for madd of 4–6 counts;
- blue for qalqalah;
- green for nasal readings (dengung);
- purple for a heavy ra (ra' tebal).

The waqf signs are picked out in amber. A key above each surah explains the
colours and the signs, in Malay when the translation is Melayu. The **tajweed**
button in the footer turns them off. In settings you can also turn off or
recolour each one, and hide the key.

### Keys

| Key        | Music                        | Quran                    |
| ---------- | ---------------------------- | ------------------------ |
| Space      | start / stop listening       | Listen & sync / stop     |
| `S` or `R` | identify again now           | Listen & sync            |
| `]` or `→` | lyrics 0.25 s sooner         | next ayah                |
| `[` or `←` | lyrics 0.25 s later          | previous ayah            |

### Settings

The **settings** button (the sliders next to Listen) opens a panel with
everything you can change. Changes take effect straight away and are saved in
the browser, or in the app. Close it with ×, Esc, Back, or a tap outside it.

| Section    | Settings |
| ---------- | -------- |
| appearance | theme (dark, light, or auto to follow the device), accent colour, colours from the album art, level meter, animations |
| quran      | translation; Arabic and translation text size; tajweed colours and the key above each surah; and each tajweed colour on its own: on or off, and which colour. A sample ayah (51:21) shows the result as you go. |
| music      | lyrics text size, lyrics timing, scrolling along with the song |
| listening  | audio source; which microphone (when there's more than one); how much audio each try sends (8 s); how often music mode tries (3 s) and re-checks (15 s); how much silence means the song stopped (4 s); how long Quran mode listens before giving up (60 s) |

The footer's translation, **tajweed** and lyric timing controls change the same
settings, and the panel keeps up with them. Microphones only have names once
the page has been allowed to use one. **reset all settings** (tap it twice)
puts everything back to the defaults, except the mode.

[`public/js/settings.js`](public/js/settings.js) holds the defaults and keeps
the changed ones in `localStorage`, under `settings`. Older versions kept the
mode, translation, tajweed and lyric timing under keys of their own; those are
moved over the first time. [`settings-panel.js`](public/js/settings-panel.js)
builds the panel from a list of rows, and `applySetting()` in
[`app.js`](public/js/app.js) puts each change into effect.

### Audio source

- **Microphone:** for sound from speakers in the room.
- **Tab / system audio:** for audio playing on the same computer, e.g. on
  headphones. Share the tab that's playing, with "Share tab audio" ticked. Only
  Chromium-based browsers (Chrome, Edge, Brave) support this.

## How it fits together

```
browser (public/)                  server (server/, Node)                  outside services
─────────────────                  ──────────────────────                  ────────────────
microphone or tab audio
 │ listener.js: AudioWorklet → 12 s ring buffer
 │ clip(): last 8 s → 16 kHz mono PCM
 │
 ├─ Music ── POST /api/recognize ──▶ recognize.js ── audio fingerprint ──▶ Shazam
 │                                                 └ Apple Music id ─────▶ iTunes (track length)
 │        ◀─ title, artist, offset ─
 │           GET /api/lyrics ──────▶ lyrics.js ──────────────────────────▶ LRCLIB
 │        ◀─ timed lines ──────────
 │
 └─ Quran ── POST /api/quran/recognize ─▶ asr.js: Whisper, on this CPU
                                          quran.js: find those words in the Quran
          ◀─ surah, ayah, ambiguous ──
             GET /api/quran/surah/:n ──▶ quran.js ── first run only ─────▶ alquran.cloud, quran.com
          ◀─ verses + translation ────   asr.js ──── first run only ─────▶ Hugging Face

app.js decides when to listen and what to show; lyrics-view.js draws it.
```

The browser captures audio and keeps time. The server does the recognition.
For music, the heavy matching happens at Shazam. For the Quran, it happens on
the server's own CPU, and nothing is sent anywhere.

## Audio capture

All in [`public/js/listener.js`](public/js/listener.js) and
[`capture-worklet.js`](public/js/capture-worklet.js).

- **Raw input.** The microphone is opened with echo cancellation, noise
  suppression and automatic gain turned off. Those are tuned for voice calls and
  mangle music. Tab audio uses `getDisplayMedia`, and the video track is dropped
  straight away.
- **Capture.** An AudioWorklet runs on the browser's audio thread. It mixes the
  input down to mono and passes it to the page in batches of 2048 samples. The
  page keeps the last 12 seconds in a ring buffer, at the device's own sample
  rate (usually 48 kHz).
- **Making a clip.** `clip(8)` copies out the latest 8 seconds, then:
  - It measures how much of the clip has sound: 100 ms windows louder than an
    RMS of 0.002 (about −54 dBFS). Clips with less than 3 seconds of sound
    aren't sent ("too quiet").
  - It normalises the volume so the peak is at 90%, boosting at most 20×,
    because Shazam's fingerprinter ignores quiet audio.
  - It resamples to 16 kHz with an `OfflineAudioContext` and converts to 16-bit
    PCM, which is what both recognisers expect.
  - It records `endedAt`, the moment the clip's last sample arrived. Music sync
    is measured from this point (see [Keeping time](#keeping-time)).
- **Silence and the meter.** Every batch updates "seconds since the last sound",
  which is how the app notices a song stopping. The top-bar meter reads an
  `AnalyserNode`: 24 bands spaced logarithmically from 60 Hz to 8 kHz, drawn
  with `▁▂▃▄▅▆▇█`.

## Music mode in detail

### The listening loop

[`public/js/app.js`](public/js/app.js) runs a small state machine:
**idle → searching → synced**.

| Situation                       | What happens                                                        |
| ------------------------------- | ------------------------------------------------------------------- |
| First attempt                   | after 4 s of audio                                                  |
| Each attempt                    | sends the last 8 s                                                  |
| Searching                       | tries every 3 s; every 10 s after 10 misses in a row                |
| Errors (e.g. a Shazam rate limit) | retries after 10 s, then 20, 40, and at most 60 s while they continue |
| Synced                          | re-checks every 15 s, or 2 s after the song should end if sooner (never sooner than 3 s) |
| Match from under 6 s of sound   | shown dimmed, confirmed 3 s later                                   |
| Lost                            | 4 s of silence, 2 misses in a row, or 1 s past the song's end       |

Only one request is in flight at a time. Pressing Sync during a request queues
another attempt right after it. A session counter throws away any response
that arrives after things have moved on, e.g. after a mode switch or stop.

### Recognition

[`lib/recognize.js`](lib/recognize.js) (shared with the Android app):

- The server hands the PCM to [`shazam-api`](https://www.npmjs.com/package/shazam-api).
  It computes Shazam's audio signature locally and sends only that signature to
  Shazam's (unofficial) endpoint, not the audio itself.
- Shazam answers with the track (title, artist, album, release year, artwork,
  Apple's artwork colour palette) and `offset`: the position in the song where
  the clip *started*. That offset is what makes syncing possible.
- Shazam doesn't report the track's length, so the server looks it up on iTunes
  with the Apple Music id (cached, 4 s timeout).
- A failed request (a rate limit, an outage, a reply in an unexpected shape, or
  no answer within 8 s) is reported as an error, and the page waits longer
  before each retry. Asking again straight away only keeps a rate limit in place.
- The page picks the most colourful palette entry that still reads well on a
  dark background, and uses it as the accent colour.

### Lyrics

[`lib/lyrics.js`](lib/lyrics.js) uses [LRCLIB](https://lrclib.net), a free
synced-lyrics database that needs no API key.

- It searches by title and artist. If that finds nothing, it retries with a bare
  title and the first artist. Shazam's names are often decorated
  ("Song (feat. X) [Remastered]", "A, B & C") where LRCLIB's aren't.
- It picks synced lyrics over plain ones, then the release whose length is
  closest to the iTunes length. A radio edit and an album version have
  different timings, so the right release matters.
- LRC lines like `[01:02.50][02:10.00] text` are parsed into
  `{ time, text }` pairs (one line can carry several time tags), and metadata
  tags like `[ar:Artist]` are skipped.
- Results are cached in memory for as long as the server runs.

### Keeping time

When a match comes back, the app stores an anchor:

```
songPos = offset + clip length          (where the song was when the clip ended)
at      = clip.endedAt
position now = songPos + (now − at) + your lyric nudge
```

Measuring from when the clip *ended*, rather than when the answer arrived,
cancels out the time spent uploading, fingerprinting and waiting for Shazam.

On every animation frame, the app finds the lyric line for the current position
(binary search), highlights it and scrolls it to the centre. A line too tall to
fit is shown from its top instead.

Each re-check compares Shazam's position with the running clock. A drift over
0.3 s re-anchors the clock (which also catches seeking), and a different song
starts over with the new one. The Sync button re-anchors even when the drift is
smaller.

Short clips have a catch: with 4 seconds of sound or less, Shazam sometimes
matches the right song at the wrong repeat of a riff. In a Get Lucky test it was
16.5 s off. So a match from under 6 seconds of sound is shown dimmed and checked
again 3 seconds later.

## Quran mode in detail

### The flow

- Switching to Quran mode calls `POST /api/quran/warmup`, so the speech model
  and the Quran index are loaded before the first check. The footer says so
  while that happens.
- **Listen & sync** makes its first attempt after 4 s, then one every second.
  Checks run locally, so there's no rate limit to respect. Each sends the last
  8 s of audio.
- Each answer is one of three things:
  - **no match:** keep listening;
  - **ambiguous:** show the best guess dimmed and keep listening;
  - **a clear match:** show it and turn the microphone off.
- After 60 s without a clear match it stops. If it had an ambiguous guess, it
  keeps that guess.
- **Listen & sync again** keeps the surah on screen and sends the first word of
  the highlighted ayah as `near`, so passages continuing from your place win
  ties.
- **− / +** always scroll the new ayah into view, even if you had scrolled away.
  Tapping a verse selects it without scrolling, and selecting text to copy
  doesn't count as a tap.

### Speech to text

[`server/asr.js`](server/asr.js) runs Tarteel's
[whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran),
a Whisper model fine-tuned on Quran recitation. It uses an
[ONNX export](https://huggingface.co/YunusZJ/whisper-base-ar-quran-ONNX) through
[transformers.js](https://huggingface.co/docs/transformers.js) and
onnxruntime, on the CPU.

- It's downloaded once from Hugging Face (383 MB) into `.cache/models/`.
- Transcriptions run one at a time, because two at once would only fight over
  the CPU.
- In a container limited to fewer CPUs than the machine has, onnxruntime would
  still start a thread for every core. The server tells it how many CPUs it can
  actually use, which took a 2-core run from 3.5 s to 1.3 s per clip. Otherwise
  onnxruntime's default (one thread per physical core) is fastest.
- The output is Arabic with vowel marks, for example
  `إِذْ جَاءَهَا الْمُرْسَلُونَ إِذْ أَرْسَلْنَا إِلَيْهِمْ` from Ya-Sin 36:13–14.

### Quran text and the index

[`lib/quran.js`](lib/quran.js) does the search. The server's
[`server/quran.js`](server/quran.js) downloads five editions the first time
(6.3 MB in `.cache/quran/`), four from [alquran.cloud](https://alquran.cloud)
and one from [quran.com](https://quran.com):

| Edition              | Used for                                                       |
| -------------------- | -------------------------------------------------------------- |
| `quran-simple-clean` | matching: plain spelling, closest to speech-to-text            |
| `qpc-hafs`           | display: the KFGQPC's Uthmani text, which its font is made for |
| `quran-tajweed`      | tajweed rules marked inline, and the surah names               |
| `en.sahih`           | English translation (Saheeh International)                     |
| `ms.basmeih`         | Malay translation (Abdullah Muhammad Basmeih)                  |

The matching edition puts the Basmala at the start of each surah's first ayah,
and the index strips it there. The display editions leave it out, and the app
shows it on its own line above the surah. Al-Fatiha is the exception, since its
Basmala is ayah 1, and At-Tawbah has none.

Both the transcript and the Quran go through the same normalisation, so small
spelling differences don't matter:

- vowel marks, Quranic annotation signs and tatweel (ـ) are removed;
- `أ إ آ ٱ` become `ا`, `ى` becomes `ي`, `ة` becomes `ه`, `ؤ` becomes `و`,
  `ئ` becomes `ي`, and `ء` is dropped;
- anything that isn't an Arabic letter becomes a space.

The index lays all 6,236 ayahs out as one sequence of about 77,800 words. It
knows which ayah each word belongs to, where each ayah starts, and every
position of every distinct word.

### Finding the passage

`locate(transcript, near)` works in steps:

1. **Vote for candidates.** For each transcript word, every place that word
   appears in the Quran votes for where the transcript would start there. Rare
   words count for more: each vote weighs log(total words ÷ occurrences of the
   word), so a word like "الله" barely counts. Votes are pooled over ±3 words,
   because recognition sometimes drops or adds a word. The 8 best distinct
   starting points go on to the next step.
2. **Align word by word.** Each candidate is compared with the transcript using
   Smith–Waterman local alignment. An exact word scores +2. A similar spelling
   (Levenshtein similarity of 0.6 or more) earns partial credit, 2 × similarity
   − 0.4. Anything else scores −1, and a skipped word −0.8.
3. **Accept or reject.** At least 3 words, and at least half the transcript,
   have to line up. A match made only of Basmala words is rejected, since the
   Basmala opens nearly every surah and says nothing about where you are.
4. **Prefer your place.** If `near` was sent, alignments that end between 30
   words before it and 400 words after it get a +2.5 bonus.
5. **Flag doubt.** If a different passage (further away than the transcript's
   length) scores within 2 points of the best, about one word's worth, the
   match is marked `ambiguous`.

The answer is the ayah containing the **last** matched word, which is where the
reciter is now.

### Accuracy

Tested on Al-Kahf (Mishary Alafasy) and Ya-Sin (Abdul Rahman Al-Sudais): 137
eight-second clips taken every 20 seconds, starting cold with no `near`. Each
was checked against quran.com's per-verse timestamps.

| Result                              | Clips     | What the app does                    |
| ----------------------------------- | --------- | ------------------------------------ |
| Right ayah, confident               | 128 (93%) | stops, done                          |
| Right ayah, flagged ambiguous       | 4 (3%)    | listens about one second longer      |
| Wrong ayah, all flagged ambiguous   | 3 (2%)    | keeps listening instead of stopping  |
| Nothing found                       | 2 (1.5%)  | keeps listening                      |

The three wrong ones were phrases that really do repeat. For example, 18:56
"وَمَا نُرْسِلُ الْمُرْسَلِينَ إِلَّا مُبَشِّرِينَ وَمُنذِرِينَ" is word for word
6:48, and the end of 18:110, "أَنَّمَا إِلَٰهُكُمْ إِلَٰهٌ وَاحِدٌ", also appears
in 21:108 and 41:6.
Music played into Quran mode finds nothing.

In a browser test that fed recitation to a fake microphone, **Listen & sync**
found the ayah 5–7 seconds after it was pressed.

### Tajweed colours

The tajweed edition marks each tajweed rule inline, for example `أَحَ[q[د]ٌ`
for the qalqalah in أَحَدٌ. Sometimes one rule sits inside another, such as a
silent alif inside a madd. `colourTajweed()` in [`lib/quran.js`](lib/quran.js)
reads the markup with a stack, so the innermost rule wins. It turns each verse
into `[text, colour]` pieces, grouped the way Malaysian mushafs colour them:

| Colour | Rules in the data                                                        |
| ------ | ------------------------------------------------------------------------ |
| red    | mad wajib muttasil and mad jaiz munfasil (4–5 counts), mad lazim (6)     |
| blue   | qalqalah                                                                 |
| green  | ghunnah, idgham with ghunnah, ikhfa', ikhfa' shafawi, iqlab, idgham shafawi |
| purple | heavy ra, worked out by the app (below)                                  |
| amber  | the waqf signs ۘ ۗ ۚ ۖ ۙ ۛ and the saktah ۜ                                   |

The other rules in the data stay uncoloured: hamzat wasl, silent letters, lam
shamsiyyah, the 2-count madd, madd at a stop, and idgham without ghunnah.

The data has no rule for ra, so the app works it out from the vowel marks:

- A ra with a fathah or dammah is heavy, and one with a kasrah is thin.
- A ra with a sukun takes after the letter before it. It is heavy after a
  fathah, a dammah or a hamzat wasl (ٱرْجِعُوا). After a kasrah it is thin,
  unless one of خ ص ض غ ط ق ظ follows in the same word (قِرْطَاس).
- A ra that ends an ayah is read as if you stop there: it takes after the
  letter before it, or, past a silent letter or long vowel, the one before
  that. It is thin after a ya (خَيْر، قَدِير). A fathatan stays a fathah
  (ـرًا).
- The imalah in مَجْر۪ٮٰهَا (11:41) is thin.

These rules gave the expected answer on about 70 test words from across the
Quran. A ra mid-ayah is coloured as read without stopping, even at a waqf sign.
A few words can be read either way: فِرْقٍ, and يَسْرِ and نُذُرِ at a stop. For
these the app shows the heavy reading.

The heavy ra letter gets purple even inside another rule's span (the ra of
خَيْرًا كَثِيرًا is also part of an ikhfa'), and its vowel marks keep the other
colour.

The tajweed edition spells some words differently from the KFGQPC text. It
leaves out some long vowels (ٱلْأَخِرَةِ for ٱلۡأٓخِرَةِ), puts the small alif on
a tatweel (أُو۟لَـٰٓئِكَ), and writes the tanwin on the alif (مَثَلاً for
مَثَلٗا). It also uses other code points for the same marks, such as ٲ for the
small alif ٰ and ْ for the sukun ۡ. So the rules are carried over: each word
is lined up with the same word of the KFGQPC text by edit distance, with those
code points counted as equal, and each character takes the colour of the one it
lines up with. A character only the KFGQPC text has, like the maddah in
ٱلۡأٓخِرَةِ, takes the colour of the letter it sits on. Over the whole Quran,
heavy ra and qalqalah land on exactly the same letters as on the tajweed
edition's own text, and red and green differ only where the spellings differ as
above. Al-Baqarah, the longest surah, takes 40 ms.

Chrome, and so the Android app's WebView, paints a vowel or sign in the colour
of the letter it sits on, whatever colour the sign's own span has. So:

- an uncoloured letter takes the colour of a tanwin, small alif or maddah on
  it, so the red of أُولَٰٓئِكَ and the green of مَثَلٗا مَّا show;
- a maddah on a red letter is red too (the data often leaves it out);
- the waqf signs get `font-feature-settings: 'calt' 0`. That makes Chrome
  shape them apart from their letter, so they can be amber. They sit high
  enough above the word to still come out in the right place.

ۜ is also the small sin on a sad that's read as sin (يَبۡصُۜطُ). Inside a word,
it isn't coloured as a waqf sign.

The coloured mushafs of Karya Bestari also mark where to stop when you run out of
breath, and where to start again (*waqaf dan ibtida'*). That guide is the
publisher's own editorial work and isn't available as open data, so the app
shows only the standard waqf signs.

### Why it doesn't follow along live

An earlier version kept listening and moved the highlight by itself. But a
recitation has no timeline: every reciter has their own pace and pauses, and a
check only knows the last word it heard. So the highlight trailed the reciter
by 3–4 seconds. Predicting ahead from the reciter's pace got it onto the right
ayah 93–94% of the time, but it was still guessing, with the microphone always
on. Finding the place once and letting you step through is simpler, never runs
ahead of you, and keeps the microphone off.

## The server

[`server/index.js`](server/index.js) is plain `node:http` with no framework.

### API

| Request                                    | Sends                                        | Returns |
| ------------------------------------------ | -------------------------------------------- | ------- |
| `POST /api/recognize`                      | 16 kHz mono s16le PCM, at most 12 s          | `{ match }`: `{ id, title, artist, album, year, coverArt, palette, shazamUrl, duration, offset }` or `null` |
| `GET /api/lyrics`                          | `title`, `artist`, optional `album`, `duration` | `{ lyrics }`: `{ instrumental, synced: [{ time, text }], plain, source }` or `null` |
| `POST /api/quran/warmup`                   | nothing                                      | `{ ready: true }` once the model and index are loaded |
| `POST /api/quran/recognize?near=N`         | PCM as above; `near` is optional             | `{ match: { surah, ayah, word, score, ambiguous } or null, transcript }` |
| `GET /api/quran/surah/:n?translation=en`   | `translation`: `en`, `ms` or `none`          | `{ surah: { number, name, englishName, englishNameTranslation, revelationType, basmala, verses: [{ number, text, segments, translation, firstWord }] } }`; `segments` are `[text, colour]` pieces (see Tajweed colours), and `basmala` is the same, or `null` for Al-Fatiha and At-Tawbah |
| any other `GET`                            |                                              | a file from `public/` |

Errors come back as `{ error }`: 400 for missing parameters, 404, 413 for clips
over 12 s, and 502 when an outside service fails.

### http and https on one port

The server listens with a raw TCP server and peeks at the first byte of each
connection. A TLS handshake starts with `0x16`, so those connections go to the
https server and everything else to the http one. Plain http from another device
gets a 308 redirect to https. Localhost stays on http, because browsers already
treat localhost as secure.

### Certificates

[`server/tls.js`](server/tls.js) runs `openssl` on first start. It makes a
self-signed RSA-2048 certificate, valid for 825 days, covering `localhost`, the
machine's hostname, `127.0.0.1` and every LAN IPv4 address, and saves it in
`certs/`.

- Delete `certs/` to make a new one, e.g. after your IP address changes.
- Put a trusted `cert.pem` / `key.pem` there (e.g. from `mkcert`) for no
  warnings at all.
- Without `openssl`, https is turned off, and only localhost can use the
  microphone.

### Configuration

| Variable   | Default            | Meaning                                                     |
| ---------- | ------------------ | ----------------------------------------------------------- |
| `PORT`     | `3000`             | port for both http and https                                |
| `HOST`     | `0.0.0.0`          | `127.0.0.1` keeps it local-only                             |
| `DATA_DIR` | the project folder | where `certs/` and `.cache/` (model, Quran text) are kept   |

## What leaves your machine

- **Music mode:** the server sends Shazam the audio *fingerprint*, not the
  audio. It sends iTunes the Apple Music id, and LRCLIB the title, artist,
  album and length. The browser loads cover art from Apple's servers.
- **Quran mode:** the audio is transcribed on your server and goes nowhere
  else. The model (from Hugging Face) and the Quran text (from alquran.cloud
  and quran.com) are each downloaded once.
- **Always:** audio from a phone goes to your server over https on your own
  network. The Arabic font comes with the app.
- **Android app:** the same services, called from the phone itself. Audio
  never leaves the phone.

## Home Assistant add-on

[`homeassistant/sound_finder/`](homeassistant/sound_finder/) packages the server
as a local add-on.

### Installing

1. Run `npm run addon`. This builds `dist/sound_finder/`: the add-on files
   together with the app.
2. Copy that folder into Home Assistant's `addons` share. Use the **Samba
   share** add-on (`\\<home-assistant>\addons`) or **Advanced SSH & Web
   Terminal**.
3. Go to **Settings → Add-ons → Add-on store → ⋮ → Check for updates**, open
   **Sound Finder** under *Local add-ons*, then install and start it.
4. Open `https://<home-assistant-ip>:3000` on your phone and accept the
   certificate warning once.

To update later, copy the new folder over the old one and press **Rebuild** on
the add-on's page.

### A dashboard button

Edit a dashboard → **Add card** → **Manual**:

```yaml
type: button
name: Sound Finder
icon: mdi:music-circle-outline
tap_action:
  action: url
  url_path: https://192.168.1.179:3000   # your Home Assistant's IP
```

It opens the app in the browser, not inside Home Assistant. A Home Assistant
served over plain http can't give a page shown inside it access to the
microphone. Use the IP rather than `homeassistant.local`, because Android phones
often can't open `.local` names.

### How the add-on is built

- **Base image:** `node:24-bookworm-slim` instead of Home Assistant's Alpine
  images, because onnxruntime needs glibc.
- **Dependencies:** installed with `npm ci --omit=dev --ignore-scripts`.
  onnxruntime's install script only fetches optional CUDA libraries. Its macOS
  and Windows builds are deleted, leaving a 690 MB image.
- **Networking:** host networking, so the certificate includes Home Assistant's
  own IP and the app is reachable on it directly. The add-on page's **Open Web
  UI** button links to it.
- **Storage:** `DATA_DIR=/data`, the add-on's persistent storage. The
  certificate survives restarts and updates, so each phone only accepts the
  warning once. The model downloads there the first time Quran mode is used.
- **Resources:** about 1.3 GB of RAM once the Quran model is loaded, and about
  1.3 s per check on 2 CPU cores. In a Proxmox VM, set the CPU type to `host`;
  the default type hides newer instructions such as AVX2.

## Android app

[`app/`](app/) packages the same page as an Android app with
[Capacitor](https://capacitorjs.com). It needs no server: the work the server
does happens on the phone.

- **Music:** the phone computes the Shazam fingerprint and sends it to Shazam
  itself. Shazam doesn't allow requests from web pages, so that one request goes
  through Android's own HTTP stack. iTunes and LRCLIB are called directly.
- **Quran:** the same speech model runs on the phone, in native code with ONNX
  Runtime ([`Whisper.java`](app/android/app/src/main/java/io/github/fardanrashidi/soundfinder/Whisper.java)). It downloads from Hugging Face
  the first time (164 MB, with progress shown), then works offline. So does the Quran text, which is kept
  after the first download.
- **Microphone only:** phones can't capture another app's audio.
- **Back button:** it closes the settings panel first, and leaves the app only
  when nothing is open ([`MainActivity.java`](app/android/app/src/main/java/io/github/fardanrashidi/soundfinder/MainActivity.java)).
  The status bar's icons switch between light and dark with the theme.

### Speed

The Quran check is the slow part. Android's WebView can't be cross-origin
isolated, so WebAssembly there gets one thread. The app therefore runs the model
in native code, which can use several cores, and uses the smaller version of
it (8-bit encoder, 4-bit decoder).

| Quran speech-to-text, one 8 s clip                    | Time        |
| ----------------------------------------------------- | ----------- |
| Server (Ryzen 7 5800X3D, full model)                  | 0.7 s       |
| The app's engine on the same PC (4 threads)           | 0.46 s      |
| Android emulator on the same PC (4 cores)             | 0.6–0.85 s  |
| The same in WebAssembly in the emulator (1 thread)    | 5.4–6.5 s   |
| A real phone                                          | not measured yet |

`Whisper.java` computes Whisper's audio features and picks tokens the way
transformers.js does. With the same model files, its transcripts match
transformers.js's on all 137 test clips, so accuracy is the same as the
server's (128 right, 4 right but flagged as uncertain, 3 wrong and flagged,
2 no match).

Music isn't affected: on the emulator, Shazam answered in about 1 s and LRCLIB
in about 2 s.

### Building

You need JDK 21 and the Android SDK (platform 36 and its build tools). Android
Studio includes both. Without it, unpack a JDK and the SDK command-line tools
into `~/Android`, then:

```sh
export JAVA_HOME=~/Android/jdk-21 ANDROID_HOME=~/Android/Sdk
npm install
npm run app:apk   # → app/android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run app` alone rebuilds the web content and copies it into the Android
project. It runs [`app/build.mjs`](app/build.mjs), which copies `public/`,
and replaces `js/api.js` with [`app/src/api.js`](app/src/api.js) (bundled
with esbuild). Then `cap sync` copies the result into the Android project.
Gradle adds ONNX Runtime's Android library, which is most of the APK's 34 MB.

### Installing on your phone

- **USB:** turn on *Developer options → USB debugging*, plug the phone in, and
  run `adb install -r app/android/app/build/outputs/apk/debug/app-debug.apk`.
- **Without a cable:** copy the APK to the phone and open it. Android asks you
  to allow installs from that app (Files, Drive, ...) once.

The first time you press Listen, Android asks for the microphone. To debug the
page, open `chrome://inspect` on the PC while the phone is plugged in.

## Performance

Measured on a Ryzen 7 5800X3D unless noted.

| What                                           | Time / size                                    |
| ---------------------------------------------- | ---------------------------------------------- |
| Music: from Listen to song shown               | about 5 s                                      |
| Shazam round trip                              | about 1 s                                      |
| Quran: speech-to-text, one 8 s clip            | 0.7–0.8 s (16 threads); 1.3 s limited to 2 cores |
| Quran: from Listen & sync to ayah shown        | 5–7 s                                          |
| Loading the cached speech model                | about 1 s                                      |
| Server memory                                  | ~120 MB; ~1.3 GB with the Quran model loaded   |
| Downloads on first Quran use                   | 383 MB model, 4.4 MB text                      |

## Project layout

```
lib/              shared by the server and the Android app
  recognize.js    Shazam recognition + iTunes track length (swap for a licensed provider later)
  lyrics.js       LRCLIB search, choosing the right release, LRC parsing
  quran.js        Quran text download, normalisation, index, finding the passage, surah data, tajweed colours
server/
  index.js        HTTP + HTTPS server on one port: /api routes and static files
  recognize.js    turns uploaded clips into samples for lib/recognize.js
  asr.js          Quran speech-to-text (Whisper via transformers.js)
  quran.js        lib/quran.js with the text cached on disk
  tls.js          self-signed certificate for https on the LAN
  paths.js        where the certificate and downloads go (DATA_DIR)
public/
  index.html      the page
  style.css       terminal look, Arabic typography, mobile layout
  fonts/          KFGQPC Uthmanic Script Hafs, the Arabic font
  js/app.js              state machine: when to listen, what to show, controls
  js/listener.js         audio capture, ring buffer, clips, level meter
  js/capture-worklet.js  audio-thread capture (mono mixdown)
  js/lyrics-view.js      lyrics and verse rendering, highlighting, scrolling
  js/settings.js         settings: defaults, saving, change notifications
  js/settings-panel.js   the settings panel
  js/api.js              backend calls (the app swaps in app/src/api.js)
app/              Android app: the same page, with the server's work done on the phone
  build.mjs       npm run app → app/www/ (public/ + bundled app/src/)
  src/api.js      public/js/api.js's functions, run locally (native HTTP for Shazam, status bar style)
  src/asr.js      Quran speech-to-text, through WhisperPlugin
  android/        Capacitor's Android project; in app/src/main/java/…/soundfinder/:
    Whisper.java        the Quran speech model, with ONNX Runtime
    WhisperPlugin.java  downloads the model, takes calls from the page
    MainActivity.java   registers the plugin, sends Back to the page first
capacitor.config.json  app id and where the Android project lives
homeassistant/
  sound_finder/   add-on: config.yaml, Dockerfile, DOCS.md
  build.sh        npm run addon → dist/sound_finder/ (add-on + app, ready to copy)
```

Generated and ignored by git: `certs/`, `.cache/`, `dist/`, `node_modules/`,
`app/www/`, and the Android build output.

## Limitations

- **Shazam's endpoint is unofficial.** It can change, break or rate-limit at any
  time. There's no backup service: AudD is the only one that works without an
  account, and in a test on 8 clips from Apple's song previews it named the right
  recording twice. The rest came back as remixes, DJ mixes or unrelated uploads.
  Even when it was right, its position was 13 s off, too far for synced lyrics.
- **Lyrics are only as good as LRCLIB.** Some songs have no synced lyrics, or
  timings that are slightly off (the lyrics − / + control is for those).
- **Tab audio** only works in Chromium-based browsers.
- **Certificate warnings:** each device sees one, because the certificate is
  self-signed.
- **Room noise is untested.** Testing used clean recordings fed straight in, not
  a real microphone in a noisy room.
- **Quran mode needs a few seconds of clear recitation.** The Basmala alone
  can't place you. A passage that repeats many times (like the refrain of
  Ar-Rahman) may take longer to settle. It highlights whole ayahs, not
  individual words.
- **Memory:** the speech model needs about 1.3 GB of RAM once loaded.

## Before turning this into a real app

- **Recognition licensing.** Fine for a personal project, but Shazam's endpoint
  isn't allowed in a published product. Use a licensed service such as ACRCloud
  instead (AudD did poorly in testing, see Limitations); only
  `lib/recognize.js` needs to change.
- **GPL.** `shazam-api` is GPL-2.0. Dropping it along with the Shazam endpoint
  also drops that obligation.
- **iPhone.** The Capacitor project could get an iOS side too, but building it
  needs a Mac with Xcode, and `Whisper.java` would need a Swift version.

## Credits and licences

- [`shazam-api`](https://www.npmjs.com/package/shazam-api): Shazam signature
  generation and lookup (GPL-2.0).
- [tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran):
  the Quran speech model (Apache-2.0), in YunusZJ's
  [ONNX export](https://huggingface.co/YunusZJ/whisper-base-ar-quran-ONNX).
- [transformers.js](https://github.com/huggingface/transformers.js) and
  onnxruntime: running the model in Node and on the phone.
- [Capacitor](https://capacitorjs.com): the Android app.
- [LRCLIB](https://lrclib.net): synced lyrics.
- [alquran.cloud](https://alquran.cloud): Quran text (from Tanzil), the
  tajweed-marked text, and translations.
- [King Fahd Glorious Quran Printing Complex](https://qurancomplex.gov.sa)
  (KFGQPC): the Uthmani text shown, and the font KFGQPC Uthmanic Script Hafs
  (version 0.18, as `public/fonts/UthmanicHafs1Ver18.woff2`). The font's
  licence lets anyone use, copy and distribute it free of charge, but not sell,
  modify or reverse engineer it, so it's included unchanged. The Complex's own
  site wasn't reachable when this was set up, so the file comes from
  [quran.com's repository](https://github.com/quran/quran.com-frontend-next/tree/production/public/fonts/quran/hafs/uthmanic_hafs).
- [quran.com](https://quran.com): the KFGQPC text (through its API), and
  per-verse recitation timings used for testing.
# quranify
