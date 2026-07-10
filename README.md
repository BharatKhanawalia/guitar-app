# 🎸 CapoFlow

**Play smarter. Sound the same.** A designer-grade guitar capo optimizer, chord-sheet transposer, and pro tuner — all client-side.

![CapoFlow](https://img.shields.io/badge/status-v1.1-8b5cf6) ![stack](https://img.shields.io/badge/React-Vite-34d399)

State that must survive tab switches (your progression, the pasted sheet, transpose amount, ♭/♯ preference) lives in a tiny global store (`src/store.jsx`) mirrored into `sessionStorage`, so nothing resets until a hard reload.

## Features

### 🎯 Capo Optimizer
Pick or type a progression and CapoFlow evaluates **every capo position (0–11)**, scoring each for playability — rewarding open chords (C, A, G, E, D, Em, Am) and penalizing barre chords (F, Bm, F#m). Highlights:
- An **"Original Chords (Capo 0)"** card shows the shapes as written, with the same open/barre counters.
- The best position gets a **"Recommended"** badge with a glow; every option shows a **Playability / Easiness** meter.
- **Every capo box is clickable** → a glassmorphism modal with large SVG chord diagrams and a per-chord *Tap to play*.

> Example: `Eb Ab Bb Cm` → **Capo 8: G C D Em** (4 open shapes, 0 barres).

### 🎼 Interactive Sheet Transposer
Paste an "Ultimate Guitar" style sheet (chords above lyrics). CapoFlow parses it with **ChordSheetJS**, renders it in a clean monospaced layout, and lets you:
- Transpose in real time with `[-] 0 [+]` (chords animate as they change)
- Tap any chord to **hear it strummed**
- **Autoscroll** hands-free with an adjustable speed slider
- **Simplify** complex chords (Cmaj13 → C) and flip the ♭/♯ toggle to respell everything instantly
- **Key detection** scores all 24 major/minor keys against the progression and **hides the badge when confidence is low** rather than guessing

### 🎯 Pro Tuner
A robust **chromatic tuner** built on the Web Audio API:
- **YIN** pitch detection with median smoothing (far fewer octave errors and jitter than naive autocorrelation)
- A **band-pass filter (≈80–1200 Hz)** on the mic stream so hum/breath/harmonics don't get chased
- A **machine-head UI**: a guitar headstock with 3+3 tuning pegs (E A D · G B e). The plucked string is identified, animated to vibrate, and its peg lights up — **green + a chime when you're within ±5¢**.

### 🥁 Strumming Studio *(dedicated tab)*
A categorized library — **Common / Uncommon / Easy / Difficult** — with a live animated playhead at adjustable tempo. Playback is **percussive**: down and up strokes trigger distinct muted-string *chucks* (and accented `✕` dead-string hits), not pitched chords.

### 🎵 Ambient polish
A lightweight cursor-following **music-note trail** spawns 🎵🎶♩ over empty space, clustering when the pointer slows — disabled automatically under `prefers-reduced-motion`.

## Design
Dark-mode glassmorphism over an animated radial-gradient field of deep blues/purples. Framer Motion throughout — staggered spring entrances, layout animations, and interactive chord SVG fretboard diagrams.

## Audio engine
The guitar is **Karplus–Strong** physical-modelling synthesis (a real excited/decaying string via `Tone.PluckSynth`), not an FM patch. Chords are voiced low→high and strummed with a ~28 ms per-string micro-delay so a click reads as a *downstroke*. To upgrade to **recorded samples**, drop files + a `manifest.json` into `public/samples/guitar-acoustic/` (see the README there) and the engine auto-switches to a `Tone.Sampler`.

## Tech Stack
| Concern | Library |
|---|---|
| App / build | React 18 + Vite |
| Styling | Tailwind CSS |
| Animation | Framer Motion |
| State | Context + sessionStorage (`src/store.jsx`) |
| Music theory | Tonal.js |
| Sheet parsing | ChordSheetJS |
| Audio engine | Tone.js (Karplus–Strong + optional Sampler) |
| Pitch detection | Web Audio API (YIN + band-pass) |

## Getting Started
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the build
```

## Keyboard Shortcuts
- `+` / `=` — transpose up
- `-` / `_` — transpose down
- `0` — reset transposition

## Notes on Architecture
- All transposition & scoring logic is **pure and synchronous** (`src/lib/chordTheory.js`) so it's instantaneous.
- Chord diagrams come from a curated open-shape library with a **movable barre-shape generator** fallback (`src/lib/chordShapes.js`).
- Page navigation uses a **keyed `motion.div`** (not `AnimatePresence mode="wait"`) so leaving a tab reliably unmounts it — the Tuner always releases the microphone and timers always stop.

## Verification
`scripts/verify.mjs` drives real Chrome (puppeteer-core) across every tab + mobile viewport, asserting content renders and capturing screenshots. Run it against a live dev server:
```bash
npm run dev &
node scripts/verify.mjs
```
