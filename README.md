# quran-finder

A web app that listens to a Quran recitation, works out the surah and ayah, and
shows the verses with an English or Malay translation.

- **Listen & sync** finds where the reciter is, highlights that ayah, and turns
  the microphone off. You move on through the verses yourself.
- **Follow** keeps listening and moves the highlight from ayah to ayah as the
  reciter goes. It checks more often as the reciter nears the end of an ayah:
  every 2 seconds then, and up to 5 seconds apart early in a long one.
- **Read aloud** reads the translation in the device's own voice, a word
  highlighted at a time. It reads either through the surah on its own, or
  ayah by ayah along with the reciter while following.
- The screen stays on while it's listening or reading.

It runs as a small Node server on your computer (or on Home Assistant). Any
phone, tablet or computer on your network opens it in the browser and uses its
own microphone. There is also an [Android app](#android-app) that does
everything on the phone, with no server.

It started as the Quran mode of
[sound-finder](https://github.com/FardanRashidi/sound-finder), without the
music side, and runs on port 3001 so the two can run side by side.

## Contents

- [Quick start](#quick-start)
- [Using it](#using-it)
- [How it fits together](#how-it-fits-together)
- [Audio capture](#audio-capture)
- [Finding the ayah](#finding-the-ayah)
- [Following the reciter](#following-the-reciter)
- [Reading the translation aloud](#reading-the-translation-aloud)
- [The server](#the-server)
- [What leaves your machine](#what-leaves-your-machine)
- [Home Assistant add-on](#home-assistant-add-on)
- [Android app](#android-app)
- [Performance](#performance)
- [Project layout](#project-layout)
- [Limitations](#limitations)
- [Credits and licences](#credits-and-licences)

## Quick start

You need Node 20 or newer, `openssl` (to make the https certificate), and an
internet connection the first time.

```sh
git clone https://github.com/FardanRashidi/quranify.git
cd quranify
npm install
npm start        # → http://localhost:3001   (npm run dev restarts on changes)
```

Open <http://localhost:3001>. The first time, the server downloads its speech
model (about 400 MB). Then press **Listen & sync** or **Follow**, allow the
microphone, and play a recitation.

### From your phone or another computer

Open the `https://<your-ip>:3001` address the server prints when it starts.
Plain `http://` redirects there. Browsers only allow the microphone on https
pages (or on localhost), so the server makes its own certificate the first time
it runs. Each device shows a warning once:

- **Chrome:** *Advanced → Proceed*
- **Safari:** *Show Details → visit this website*
- **Firefox:** *Accept the Risk and Continue*

If the device still can't connect, check your firewall. For example, with ufw:
`sudo ufw allow from 192.168.1.0/24 to any port 3001 proto tcp`.

### On Home Assistant

The [`homeassistant/`](homeassistant/) folder is a Home Assistant add-on, which
needs Home Assistant OS or Supervised. See
[Home Assistant add-on](#home-assistant-add-on).

## Using it

The top bar has the audio source, the [settings](#settings) button, **Follow**
and **Listen & sync**. A live level meter shows what the app hears. Once a
surah is found, its name sits above the verses with the **read aloud** button
and its speed. The footer shows the status, the ayah controls, the translation
and the tajweed switch.

The server starts loading its speech model as soon as the page opens. The
first time ever, that's a 400 MB download, which takes a minute; the footer
shows its progress.

### Finding your place: Listen & sync

1. Press **Listen & sync** (or Space) and play a recitation. It listens until
   it knows where the reciter is, usually 5–7 seconds. Then it shows the surah,
   highlights the ayah, and turns the microphone off.
2. Move through the verses yourself with **− / +** in the footer, `[` `]`, the
   arrow keys, or by tapping a verse.
3. Lost your place, or did the reciter jump? Press **sync** next to the ayah
   buttons (or **Listen & sync** again). The surah stays on screen while it
   listens, and it prefers matches that continue from where you are.

Some phrases appear word for word in more than one place in the Quran. If what
it heard could be either, it shows its best guess dimmed and keeps listening
until the reciter says something that settles it. It gives up after 60 seconds
without a match.

### Following along: Follow

1. Press **Follow** (or `F`). It searches the same way, but once it has found
   the reciter it keeps listening. The highlight moves to each new ayah as the
   reciter reaches it, and the page scrolls along with it.
2. How often it checks depends on how soon the reciter should finish the
   ayah, at the pace they've been going. Near the end it checks every 2
   seconds. With a long way to go it waits up to 5 seconds. So at a normal
   pace, short ayahs get a check every 2 seconds, while a slow reciter gets
   5-second waits even in short ones. The footer counts down to the next
   check: `following Yaseen 36:12 · next check in 3s`.
3. When it hears the reciter finish an ayah, it moves on to the next one
   straight away, without waiting to hear it begin.
4. If it can't place the reciter for 12 seconds (a long pause, noise, or a
   passage it can't tell apart from another), the verses dim and it keeps
   listening. After 60 seconds without placing them, it stops.
5. Press **Follow** again, **Stop**, or Space to stop. Pressing **Follow**
   while **Listen & sync** is still searching makes it carry on following once
   it finds the place.

If you scroll yourself, the auto-scroll pauses for 4 seconds. You can still
step or tap to another ayah, but the next check moves the highlight back to the
reciter. Following uses more CPU than a single sync, about 11 checks a minute;
see [Following the reciter](#following-the-reciter) for how it's timed and how
well it keeps up.

### Hearing the translation: read aloud

1. With a surah on screen, press the speaker button above the verses (or `T`).
   It reads the translation of the highlighted ayah, highlighting each word as
   it's said, then moves to the next ayah and carries on to the end of the
   surah. Press it again to stop.
2. The **1×** button next to it steps through 0.75, 1, 1.25, 1.5 and 2× speed.
   The settings have a slider from 0.5× to 2×, and a choice of voice. Changing
   either one says the current sentence again.
3. **− / +**, the arrow keys, or tapping a verse reads from there instead.
4. **With Follow on**, it reads each ayah as the reciter reaches it, so you
   hear the meaning of what's being recited. If the reciter has moved on by
   the time it finishes, it skips to where they are. If it finishes first, it
   waits for the reciter to start the next ayah. Stopping Follow also stops
   the reading.

The microphone would hear the voice through the speaker and get confused. So
while it reads, Follow pauses its checks, and afterwards it only listens to
the audio recorded since the voice stopped. With headphones, or with tab audio
as the source, turn on **keep listening while reading** in the settings, and it
keeps checking the whole time.

The voices are the device's own:

- **English** can use any English voice.
- **Malay** uses a Malay voice if the device has one, otherwise an Indonesian
  one, which is close enough to follow.
- Windows, macOS, iOS and Android come with voices. Chrome and Firefox on
  Linux only have them when `speech-dispatcher` is installed.
- On Android you can add voices under *Settings → System → Languages → Text-to-speech
  output*.

Where a browser has no voices at all, the button is hidden and the settings say
so. The button is also hidden when the translation is set to **None**.

### Keeping the screen on

While it's listening (searching or following) or reading aloud, the screen
doesn't go to sleep. When it stops, the screen goes back to its usual timeout.

- **In the browser**, this uses the
  [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API):
  Chrome and Edge 84+, Safari 16.4+ (iOS too), and Firefox 126+. It needs an https page, which the app already is. Browsers release it
  when you switch to another tab or app, so the app asks again when you come
  back. Some browsers refuse it in battery-saver mode, and then the screen
  sleeps as usual.
- **In the Android app**, it sets the window's `FLAG_KEEP_SCREEN_ON`, which
  works everywhere and needs no permission.

### Translations and tajweed

Translations: **English** (Saheeh International), **Melayu** (Abdullah
Muhammad Basmeih), or **None**.

The verses are shown in the Uthmani text and font of the King Fahd Complex
(KFGQPC), the same as the Madinah mushaf, with each ayah number in an
end-of-ayah sign. They are coloured the way Malaysian tajweed mushafs colour
them:

- red for madd of 4–6 counts;
- blue for qalqalah;
- green for nasal readings (dengung);
- purple for a heavy ra (ra' tebal).

The waqf signs are picked out in amber. A key above each surah explains the
colours and the signs, in Malay when the translation is Melayu. The **tajweed**
button in the footer turns them off. In settings you can also turn off or
recolour each one, and hide the key.

### Keys

| Key        | Does                                          |
| ---------- | --------------------------------------------- |
| Space      | Listen & sync / stop                          |
| `S` or `R` | check again now (starts Listen & sync if stopped) |
| `F`        | Follow on / off                               |
| `T`        | read aloud on / off                           |
| `]` or `→` | next ayah                                     |
| `[` or `←` | previous ayah                                 |

### Settings

The **settings** button (the sliders next to Follow) opens a panel with
everything you can change. Changes take effect straight away and are saved in
the browser, or in the app. Close it with ×, Esc, Back, or a tap outside it.

| Section       | Settings |
| ------------- | -------- |
| appearance    | theme (dark, light, or auto to follow the device), accent colour, level meter, animations |
| verses        | translation; Arabic and translation text size; tajweed colours and the key above each surah; and each tajweed colour on its own: on or off, and which colour. A sample ayah (51:21) shows the result as you go. |
| following     | scroll along to each ayah (on); the shortest wait between checks (2 s, from 1 to 5) and the longest (5 s, from 2 to 15) |
| reading aloud | speed (1×, from 0.5× to 2×); the voice for the translation's language, with a **try** button to hear it; keep listening while reading (off) |
| listening     | audio source; which microphone (when there's more than one); how much audio each check sends (8 s); how long it listens without placing the reciter before giving up (60 s) |

The footer's translation and **tajweed** controls and the speed button change
the same settings, and the panel keeps up with them. Microphones only have
names once the page has been allowed to use one. **reset all settings** (tap it
twice) puts everything back to the defaults.

[`public/js/settings.js`](public/js/settings.js) holds the defaults and keeps
the changed ones in `localStorage`, under `settings`.
[`settings-panel.js`](public/js/settings-panel.js) builds the panel from a list
of rows, and `applySetting()` in [`app.js`](public/js/app.js) puts each change
into effect.

### Audio source

- **Microphone:** for a recitation from speakers in the room.
- **Tab / system audio:** for a recitation playing on the same computer, e.g.
  on headphones. Share the tab that's playing, with "Share tab audio" ticked.
  Only Chromium-based browsers (Chrome, Edge, Brave) support this.

## How it fits together

```
browser (public/)                          server (server/, Node)                outside services
─────────────────                          ──────────────────────                ────────────────
microphone or tab audio
 │ listener.js: AudioWorklet → 12 s ring buffer
 │ clip(): last 8 s → 16 kHz mono PCM
 │
 ├── POST /api/quran/recognize?near=N ──▶ asr.js: Whisper, on this CPU
 │                                        quran.js: find those words in the Quran
 │   ◀─ surah, ayah, word, ambiguous ───
 │      GET /api/quran/surah/:n ────────▶ quran.js ── first run only ──▶ alquran.cloud, quran.com
 │   ◀─ verses + translation ───────────  asr.js ──── first run only ──▶ Hugging Face
 │
 └── reader.js → speech.js: the device's own voices (speechSynthesis)

app.js decides when to listen and what to show; follow.js times the checks
while following; verses-view.js draws the verses and highlights.
```

The browser captures audio, keeps time and reads aloud. The server does the
recognition on its own CPU, and nothing is sent anywhere else.

## Audio capture

All in [`public/js/listener.js`](public/js/listener.js) and
[`capture-worklet.js`](public/js/capture-worklet.js).

- **Raw input.** The microphone is opened with echo cancellation, noise
  suppression and automatic gain turned off. Those are tuned for calls, and
  can strip a recitation out as echo or noise. Tab audio uses
  `getDisplayMedia`, and the video track is dropped straight away.
- **Capture.** An AudioWorklet runs on the browser's audio thread. It mixes the
  input down to mono and passes it to the page in batches of 2048 samples. The
  page keeps the last 12 seconds in a ring buffer, at the device's own sample
  rate (usually 48 kHz).
- **Making a clip.** `clip(8)` copies out the latest 8 seconds, then:
  - It measures how much of the clip has sound: 100 ms windows louder than an
    RMS of 0.002 (about −54 dBFS). Clips with less than 3 seconds of sound
    aren't sent ("too quiet").
  - It normalises the volume so the peak is at 90%, boosting at most 20×, so a
    quiet recording reaches the speech model at a good level.
  - It resamples to 16 kHz with an `OfflineAudioContext` and converts to 16-bit
    PCM, which is what the speech model expects.
  - It records `endedAt`, the moment the clip's last sample arrived. Following
    measures the reciter's pace from this.
- **The meter.** The top-bar meter reads an `AnalyserNode`: 24 bands spaced
  logarithmically from 60 Hz to 8 kHz, drawn with `▁▂▃▄▅▆▇█`.

## Finding the ayah

### The flow

- Opening the page calls `POST /api/quran/warmup`, so the speech model and the
  Quran index are loaded before the first check. The footer says so while that
  happens.
- **Listen & sync** makes its first attempt after 4 s, then one every second.
  Checks run locally, so there's no rate limit to respect. Each sends the last
  8 s of audio.
- Each answer is one of three things:
  - **no match:** keep listening;
  - **ambiguous:** show the best guess dimmed and keep listening;
  - **a clear match:** show it and turn the microphone off (or, with Follow,
    carry on following).
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

The index lays all 6,236 ayahs out as one sequence of 77,797 words. It knows
which ayah each word belongs to, where each ayah starts, and every position of
every distinct word.

### Finding the passage

`locate(transcript, near)` works in steps:

1. **Vote for candidates.** For each transcript word, every place that word
   appears in the Quran votes for where the transcript would start there. Rare
   words count for more: each vote weighs log(total words ÷ occurrences of the
   word), so a word like "الله" barely counts. Votes are pooled over ±3 words,
   because recognition sometimes drops or adds a word. The 8 best distinct
   starting points go on to the next step. If `near` was sent, so do the 3
   best that would carry on from it, closest first. Otherwise a passage that's
   in many places, like Ar-Rahman's refrain, could fill all 8 with copies from
   elsewhere.
2. **Align word by word.** Each candidate is compared with the transcript using
   Smith–Waterman local alignment. An exact word scores +2. A similar spelling
   (Levenshtein similarity of 0.6 or more) earns partial credit, 2 × similarity
   − 0.4. Anything else scores −1, and a skipped word −0.8.
3. **Prefer your place.** If `near` was sent, alignments that end between 30
   words before it and 400 words after it get a +2.5 bonus, and the match is
   marked `continues`. The bonus shrinks by 0.002 for every word away from
   `near` (at most 0.8, less than a word's worth), so of two identical copies,
   the closer one wins.
4. **Accept or reject.** At least 3 words, and at least half the transcript,
   have to line up. Just after `near` (up to 20 words on), 2 words are enough:
   a slow reciter often gets only two or three words into a clip, and the
   speech model sometimes misspells one. A match made only of Basmala words is
   rejected, since the Basmala opens nearly every surah and says nothing about
   where you are.
5. **Flag doubt.** If a different passage (further away than the transcript's
   length) scores within 2 points of the best, about one word's worth, the
   match is marked `ambiguous`.

The answer is the ayah containing the **last** matched word, which is where the
reciter is now. It also gives that word's place in the whole Quran (`word`)
and the place of the ayah's last word (`ayahEnd`). When the two are the same,
the reciter has just finished the ayah.

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
in 21:108 and 41:6. Music played into it finds nothing.

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

## Following the reciter

A recitation has no timeline to sync to: every reciter has their own pace and
pauses, and a check only knows the last word it heard. Following is a loop in
[`public/js/app.js`](public/js/app.js), with the decisions in
[`public/js/follow.js`](public/js/follow.js).

### When to check

Each check costs a transcription (0.7–1.3 s of CPU), so they're spaced out by
how soon the reciter should finish the ayah on screen:

- **Pace.** Each match that continues from the last one gives a pace: words
  moved ÷ seconds between the two clips, pauses included. The app keeps a
  running average that forgets over about 15 seconds, starting from 0.8 words
  a second. In the test recitations below, the pace ran from 0.34 words a
  second (Husary in Ar-Rahman, Abdul Basit's mujawwad An-Naba) to 1.19
  (Shuraim in Al-Kahf).
- **Wait.** The next check is due when the reciter should have said the ayah's
  remaining words plus one more, at that pace. The extra word is there because
  the speech model only writes a word once it has heard all of it. The wait
  is kept between the two settings, 2 and 5 seconds by default. So at a
  normal pace a short ayah gets a check every 2 seconds, while early in a long
  ayah the checks are 5 seconds apart and get closer as the reciter nears its
  end.
- **Searching** checks every second: before the reciter is found, and while
  what it heard could be more than one place.

### What a check does

- **The reciter finished the ayah.** When the last word heard is the ayah's
  last word, the highlight moves to the next ayah straight away. Waiting
  instead for a check to hear the next ayah's first words would leave it a few
  seconds behind every time; this is the biggest single gain in the tests
  below.
- **A match further on** moves the highlight there, and updates the pace.
- **A match elsewhere** that isn't ambiguous means the reciter jumped, so it
  goes there.
- **An ambiguous match** (a phrase that's in more than one place) only counts
  if it carries on from the last place and is within reach. That means it's
  not behind the last place, and no further on than twice what the reciter's
  pace covers in the time since, plus 6 words. Otherwise it's ignored: a
  reciter going on to the next copy of a refrain is far more likely than one
  skipping twenty ayahs. Without this, a misheard word once took Ar-Rahman
  from 55:13 to the refrain at 55:34.
- **No match.** Nothing moves. After 12 seconds without placing the reciter,
  the verses dim. After 60 seconds, it stops.

Each check sends the last word heard as `near`, so `locate()` prefers the
passage that carries on from it.

### How well it keeps up

Six recitations, 71 minutes in all, by six reciters, at paces from 0.34 to
1.19 words a second:

| Recitation                                   | Ayahs | Style            |
| -------------------------------------------- | ----- | ---------------- |
| Ya-Sin (36), Abdul Rahman Al-Sudais           | 83    | murattal         |
| Al-Mulk (67), Muhammad Siddiq Al-Minshawi     | 30    | murattal         |
| Ar-Rahman (55), Mahmoud Khalil Al-Husary      | 78    | slow murattal, with the refrain 31 times |
| An-Naba (78), Abdul Basit Abdul Samad         | 40    | mujawwad (slow and melodic) |
| Al-Baqarah 2:255–286, Mishary Alafasy         | 32    | murattal, long ayahs (up to 128 words) |
| Al-Kahf 18:1–31, Saud Al-Shuraim              | 31    | fast murattal    |

Each was transcribed the way the app would, from the 8 s clip ending at every
half second. Then each way of timing the checks was replayed over those
transcripts, scored against quran.com's per-word timings. A check was taken
to need 0.8 s, as on the PC below; the second set of numbers assumes 2 s, like
Home Assistant on 2 cores plus the trip from the phone.

- **Right ayah** is the share of the recitation during which the highlight was
  on the ayah being recited. Showing the next ayah once the last word has been
  said also counts as right.
- **Lag** is how long after the reciter starts an ayah the highlight gets
  there. It's negative when the highlight moved first, in the pause between
  ayahs.

| How it checks                                  | Right ayah | Lag: median, 90% | Checks a minute | With 2 s checks |
| ---------------------------------------------- | ---------- | ---------------- | --------------- | --------------- |
| every 1 s                                      | 93.8%      | −0.6 s, 0.5 s    | 33              | 86.9%           |
| every 3 s                                      | 89.5%      | 0.5 s, 2.3 s     | 16              | 79.4%           |
| every 5 s                                      | 81.9%      | 1.5 s, 5.5 s     | 10.5            | 70.2%           |
| by ayah length: a third of the ayah, 2–5 s     | 86.8%      | 0.8 s, 3.6 s     | 12.6            | 76.0%           |
| **Follow**, 2–5 s (the default)                | **89.9%**  | 0.4 s, 2.4 s     | 11.4            | 80.2%           |
| Follow, without moving on at the ayah's end    | 65.3%      | 4.5 s, 6.1 s     | 14.4            | 52.5%           |

Follow gets within 4 points of checking every second, with a third of the
checks. It's ahead of the reciter 0.6% of the time and behind 8.1%. The rest is
the first few seconds, before it has found them. A shortest wait of 1 or 1.5 s,
or a longest of 4 s, came out within half a point of 2–5 s; a longest of 6 s
was 2 points worse.

By recitation, with Follow's defaults:

| Recitation               | Right ayah | With 2 s checks |
| ------------------------ | ---------- | --------------- |
| Al-Baqarah 2:255–286     | 96.9%      | 92.8%           |
| Al-Mulk                  | 91.9%      | 79.5%           |
| Ar-Rahman                | 90.6%      | 87.0%           |
| Al-Kahf 18:1–31          | 87.2%      | 78.6%           |
| An-Naba (mujawwad)       | 87.1%      | 76.4%           |
| Ya-Sin                   | 85.6%      | 66.7%           |

The fast reciters lose the most to slow checks, because they finish short ayahs
in a couple of seconds. The rules for repeated passages and two-word matches
came out of these tests. Before them, Follow was on the right ayah 81% of the
time overall: 58% in Ar-Rahman, where the refrain kept sending it to other
copies, and 69% in An-Naba.

In the browser, with a recitation as a fake microphone, Follow found Ar-Rahman
7.8 s after it was pressed. It then moved through 55:3 to 55:23, refrains
included, in order. Ya-Sin went from 36:4 to 36:23 the same way.

## Reading the translation aloud

### In the browser

[`public/js/speech.js`](public/js/speech.js) wraps the Web Speech API's
`speechSynthesis`:

- `voices()` waits for the voice list, which Chrome fills in a moment after
  the page loads.
- `speak()` resolves `true` when the text has been said and `false` when it was
  stopped. It reports each word as it's said, from the voice's `boundary`
  events.

[`public/js/reader.js`](public/js/reader.js) reads an ayah's translation:

- **Voice.** The one picked in the settings, else the device's default for the
  language, else the first that fits. English takes `en-US`, then any `en`.
  Malay takes `ms-MY`, `ms`, then `id-ID` and `id`.
- **Pieces.** Chrome stops some voices (Google's online ones) after about 15
  seconds of speech. So a long translation is said in pieces of about 160
  characters (fewer below 1×), split at the end of a sentence, clause or word.
  A change of speed or voice says the current piece again.
- **Word highlight.** The word being said is marked with the
  [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API)
  (`::highlight(spoken)`), so the translation's text is never re-rendered, and
  it's scrolled into view if it isn't already. Not every voice reports words.
  Without them, only the ayah is marked as being read.

`readAloud()` in `app.js` runs the loop. On its own it reads ayah after ayah to
the end of the surah. While following, it reads the ayah the reciter is on.
When it finishes, it either jumps to where the reciter has got to, or waits
for the next ayah to start.

With the microphone as the source, the checks don't run while the voice is
speaking. Afterwards they send only the audio recorded since it stopped, once
there's at least 4 seconds of it. That time doesn't count towards the 12 s
"can't hear the reciter" or the 60 s give-up timers either. **keep listening
while reading** turns all of that off, for headphones.

### In the Android app

Android's WebView has no `speechSynthesis`. So the app swaps in
[`app/src/speech.js`](app/src/speech.js), which has the same functions but
calls [`SpeechPlugin.java`](app/android/app/src/main/java/io/github/fardanrashidi/quranfinder/SpeechPlugin.java),
built on Android's `TextToSpeech`:

- `voices` lists the installed voices of the phone's speech engine (usually
  Google's). Voices that still need downloading are left out.
- `speak` uses the chosen voice, or falls back to the language, and reports
  each word from `onRangeStart` where the engine supports it (Android 8 and
  later).
- `stop` resolves the reading in progress as stopped, even with engines that
  don't say so themselves.

## The server

[`server/index.js`](server/index.js) is plain `node:http` with no framework.

### API

| Request                                    | Sends                                        | Returns |
| ------------------------------------------ | -------------------------------------------- | ------- |
| `POST /api/quran/warmup`                   | nothing                                      | `{ ready: true }` once the model and index are loaded |
| `POST /api/quran/recognize?near=N`         | 16 kHz mono s16le PCM, at most 12 s; `near` (a word's place in the whole Quran) is optional | `{ match: { surah, ayah, word, ayahEnd, score, ambiguous, continues } or null, transcript }` |
| `GET /api/quran/surah/:n?translation=en`   | `translation`: `en`, `ms` or `none`          | `{ surah: { number, name, englishName, englishNameTranslation, revelationType, basmala, verses: [{ number, text, segments, translation, firstWord, words }] } }`; `segments` are `[text, colour]` pieces (see Tajweed colours), `basmala` is the same, or `null` for Al-Fatiha and At-Tawbah, and `firstWord` / `words` place each ayah in the index |
| any other `GET`                            |                                              | a file from `public/` |

Errors come back as `{ error }`: 404 for an unknown route or surah, 405, 413
for clips over 12 s, and 502 for anything else, such as the Quran text failing
to download.

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
| `PORT`     | `3001`             | port for both http and https                                |
| `HOST`     | `0.0.0.0`          | `127.0.0.1` keeps it local-only                             |
| `DATA_DIR` | the project folder | where `certs/` and `.cache/` (model, Quran text) are kept   |

## What leaves your machine

- **Recognition:** the audio is transcribed on your server and goes nowhere
  else. The model (from Hugging Face) and the Quran text (from alquran.cloud
  and quran.com) are each downloaded once.
- **Reading aloud:** the device's voice is given the translation text, never
  the audio. Most voices run on the device. A few are online, such as Chrome's
  "Google …" voices on a computer and Edge's "Online (Natural)" voices, and
  they send the text to Google or Microsoft. Pick another voice in the
  settings if that matters to you.
- **Always:** audio from a phone goes to your server over https on your own
  network. The Arabic font comes with the app.
- **Android app:** the same downloads, made from the phone itself. Audio never
  leaves the phone.

## Home Assistant add-on

[`homeassistant/quran_finder/`](homeassistant/quran_finder/) packages the server
as a local add-on.

### Installing

1. Run `npm run addon`. This builds `dist/quran_finder/`: the add-on files
   together with the app.
2. Copy that folder into Home Assistant's `addons` share. Use the **Samba
   share** add-on (`\\<home-assistant>\addons`) or **Advanced SSH & Web
   Terminal**.
3. Go to **Settings → Add-ons → Add-on store → ⋮ → Check for updates**, open
   **Quran Finder** under *Local add-ons*, then install and start it.
4. Open `https://<home-assistant-ip>:3001` on your phone and accept the
   certificate warning once.

To update later, copy the new folder over the old one and press **Rebuild** on
the add-on's page. It uses port 3001, so it can run beside the Sound Finder
add-on.

### A dashboard button

Edit a dashboard → **Add card** → **Manual**:

```yaml
type: button
name: Quran Finder
icon: mdi:book-open-variant
tap_action:
  action: url
  url_path: https://192.168.1.179:3001   # your Home Assistant's IP
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
  warning once. The model downloads there the first time it's needed.
- **Resources:** about 1.3 GB of RAM once the model is loaded, and about 1.3 s
  per check on 2 CPU cores. **Follow** makes about 10 checks a minute, so it
  keeps those cores busy about a fifth of the time, for as long as it's on. In a
  Proxmox VM, set the CPU type to `host`; the default type hides newer
  instructions such as AVX2.
- **Voices:** reading aloud uses the voices of the phone or computer the page
  is open on, not the add-on.

## Android app

[`app/`](app/) packages the same page as an Android app with
[Capacitor](https://capacitorjs.com). It needs no server: the work the server
does happens on the phone. Its id is `io.github.fardanrashidi.quranfinder`, so
it installs beside the sound-finder app.

- **Speech to text:** the same speech model runs on the phone, in native code
  with ONNX Runtime
  ([`Whisper.java`](app/android/app/src/main/java/io/github/fardanrashidi/quranfinder/Whisper.java)).
  It downloads from Hugging Face the first time (164 MB, with progress shown),
  then works offline. So does the Quran text, which is kept after the first
  download.
- **Reading aloud:** Android's own text-to-speech, through
  [`SpeechPlugin.java`](app/android/app/src/main/java/io/github/fardanrashidi/quranfinder/SpeechPlugin.java)
  (see [In the Android app](#in-the-android-app)).
- **Screen on:** [`ScreenPlugin.java`](app/android/app/src/main/java/io/github/fardanrashidi/quranfinder/ScreenPlugin.java)
  sets `FLAG_KEEP_SCREEN_ON` while it's listening or reading.
- **Microphone only:** phones can't capture another app's audio.
- **Back button:** it closes the settings panel first, and leaves the app only
  when nothing is open ([`MainActivity.java`](app/android/app/src/main/java/io/github/fardanrashidi/quranfinder/MainActivity.java)).
  The status bar's icons switch between light and dark with the theme.

On the Android emulator, with the eSpeak NG engine, the speech plugin listed
the voices (Malay included), read a translation through to the end, stopped
part-way when asked, and let a new reading cut off the one before. Keeping the
screen on set and cleared the window flag. eSpeak NG doesn't report words, so
the word highlight there was missing. The emulator's own Google voices were
missing their voice data, so they couldn't be tried.

### Speed

The check is the slow part. Android's WebView can't be cross-origin isolated,
so WebAssembly there gets one thread. The app therefore runs the model in
native code, which can use several cores, and uses the smaller version of it
(8-bit encoder, 4-bit decoder).

| Speech-to-text, one 8 s clip                          | Time        |
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
project. It runs [`app/build.mjs`](app/build.mjs), which copies `public/` and
replaces `js/api.js` and `js/speech.js` with
[`app/src/api.js`](app/src/api.js) and [`app/src/speech.js`](app/src/speech.js)
(bundled with esbuild). Then `cap sync` copies the result into the Android
project. Gradle adds ONNX Runtime's Android library, which is most of the
APK's 34 MB.

### Installing on your phone

- **USB:** turn on *Developer options → USB debugging*, plug the phone in, and
  run `adb install -r app/android/app/build/outputs/apk/debug/app-debug.apk`.
- **Without a cable:** copy the APK to the phone and open it. Android asks you
  to allow installs from that app (Files, Drive, ...) once.

The first time you press Listen & sync or Follow, Android asks for the
microphone. To debug the page, open `chrome://inspect` on the PC while the
phone is plugged in.

## Performance

Measured on a Ryzen 7 5800X3D unless noted.

| What                                           | Time / size                                    |
| ---------------------------------------------- | ---------------------------------------------- |
| Speech-to-text, one 8 s clip                   | 0.7–0.8 s (16 threads); 1.3 s limited to 2 cores |
| From Listen & sync to ayah shown               | 5–7 s                                          |
| Checks a minute                                | about 35 while searching; about 11 while following |
| Loading the cached speech model                | about 1 s                                      |
| Server memory                                  | ~120 MB; ~1.3 GB with the model loaded         |
| Downloads on first use                         | 383 MB model, 4.4 MB text                      |

## Project layout

```
lib/
  quran.js        Quran text download, normalisation, index, finding the passage, surah data, tajweed colours
                  (shared by the server and the Android app)
server/
  index.js        HTTP + HTTPS server on one port: /api routes and static files
  asr.js          speech-to-text (Whisper via transformers.js)
  quran.js        lib/quran.js with the text cached on disk
  tls.js          self-signed certificate for https on the LAN
  paths.js        where the certificate and downloads go (DATA_DIR)
public/
  index.html      the page
  style.css       terminal look, Arabic typography, mobile layout
  fonts/          KFGQPC Uthmanic Script Hafs, the Arabic font
  js/app.js              state machine: when to listen, what to show, reading aloud, controls
  js/follow.js           following: where the reciter is, the pace, when to check next
  js/listener.js         audio capture, ring buffer, clips, level meter
  js/capture-worklet.js  audio-thread capture (mono mixdown)
  js/verses-view.js      verse rendering, highlighting the ayah and the word being read, scrolling
  js/reader.js           reading a translation aloud: voice, pieces, words
  js/speech.js           the browser's speechSynthesis (the app swaps in app/src/speech.js)
  js/settings.js         settings: defaults, saving, change notifications
  js/settings-panel.js   the settings panel
  js/api.js              backend calls and the screen wake lock (the app swaps in app/src/api.js)
app/              Android app: the same page, with the server's work done on the phone
  build.mjs       npm run app → app/www/ (public/ + bundled app/src/)
  src/api.js      public/js/api.js's functions, run locally (plus status bar style and keeping the screen on)
  src/asr.js      speech-to-text, through WhisperPlugin
  src/speech.js   public/js/speech.js's functions, through SpeechPlugin
  android/        Capacitor's Android project; in app/src/main/java/…/quranfinder/:
    Whisper.java        the speech model, with ONNX Runtime
    WhisperPlugin.java  downloads the model, takes calls from the page
    SpeechPlugin.java   Android text-to-speech: voices, speak, stop, word events
    ScreenPlugin.java   keeps the screen on
    MainActivity.java   registers the plugins, sends Back to the page first
capacitor.config.json  app id and where the Android project lives
homeassistant/
  quran_finder/   add-on: config.yaml, Dockerfile, DOCS.md
  build.sh        npm run addon → dist/quran_finder/ (add-on + app, ready to copy)
```

Generated and ignored by git: `certs/`, `.cache/`, `dist/`, `node_modules/`,
`app/www/`, and the Android build output.

## Limitations

- **Room noise is untested.** Testing used clean recordings fed straight in, not
  a real microphone in a noisy room.
- **It needs a few seconds of clear recitation.** The Basmala alone can't place
  you. A passage that repeats many times (like the refrain of Ar-Rahman) may
  take longer to settle.
- **Following moves ayah by ayah**, not word by word, and it can only know
  where the reciter was at the end of the last clip. When the reciter starts
  an ayah without the previous one's end being heard, the highlight gets
  there a couple of seconds late.
- **A slow server falls further behind.** With checks taking 2 s (Home
  Assistant on 2 cores), Follow was on the right ayah 80% of the time instead
  of 90%, and 67% for Sudais's quick Ya-Sin.
- **Reading aloud through a speaker** pauses Follow's checks while the voice
  speaks, so a fast reciter can get ahead and some ayahs go unread. Headphones
  with **keep listening while reading** avoid that.
- **The word highlight** depends on the voice reporting its words. Some don't
  (eSpeak NG on Android, for one), and then only the ayah is marked.
- **You can't open a surah by hand.** Reading aloud and the ayah buttons work
  on the surah a recitation found.
- **Tab audio** only works in Chromium-based browsers.
- **Certificate warnings:** each device sees one, because the certificate is
  self-signed.
- **Memory:** the speech model needs about 1.3 GB of RAM once loaded.
- **iPhone:** the Capacitor project could get an iOS side too, but building it
  needs a Mac with Xcode, and `Whisper.java`, `SpeechPlugin.java` and
  `ScreenPlugin.java` would need Swift versions. The web page works in Safari.

## Credits and licences

- [tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran):
  the speech model (Apache-2.0), in YunusZJ's
  [ONNX export](https://huggingface.co/YunusZJ/whisper-base-ar-quran-ONNX).
- [transformers.js](https://github.com/huggingface/transformers.js) and
  onnxruntime: running the model in Node and on the phone.
- [Capacitor](https://capacitorjs.com): the Android app.
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
  per-verse and per-word recitation timings used for testing.
