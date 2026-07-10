# Optional: real acoustic-guitar samples

CapoFlow sounds great out of the box using **Karplus–Strong** plucked-string
synthesis (physical modelling — a real decaying string, not an FM patch).

If you want to upgrade to **recorded acoustic-guitar samples**, drop the audio
files in this folder and list them in `manifest.json`. The engine
(`src/lib/audioEngine.js`) fetches this manifest on first play and, if it finds
notes, auto-switches to a `Tone.Sampler` built from them. An empty `{}` (the
default) simply keeps the synthesized strings.

## What files to provide

- Format: `.mp3` or `.wav` (mp3 is smaller and fine).
- Pitch coverage: one sample roughly every **3–4 semitones** across the guitar
  range **E2 → E5**. Tone.js pitch-shifts to fill the gaps, so you don't need
  every note.
- Naming: anything you like — the manifest maps note → filename.

A great free source is the **nbrosowsky / tonejs-instruments "guitar-acoustic"**
set (or the Salamander guitar samples).

## manifest.json shape

```json
{
  "A2": "A2.mp3",
  "C3": "C3.mp3",
  "D#3": "Ds3.mp3",
  "F#3": "Fs3.mp3",
  "A3": "A3.mp3",
  "C4": "C4.mp3",
  "D#4": "Ds4.mp3",
  "F#4": "Fs4.mp3",
  "A4": "A4.mp3",
  "C5": "C5.mp3",
  "E5": "E5.mp3"
}
```

Filenames are resolved relative to this folder (`/samples/guitar-acoustic/`).
Use `#` for sharps in the note key (e.g. `"D#3"`). That's it — reload and play.
