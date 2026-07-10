import * as Tone from 'tone'
import { Chord, Note } from 'tonal'
import { parseChord } from './chordTheory'

/**
 * audioEngine.js — CapoFlow's sound.
 *
 * TWO independent voices:
 *
 *  1. Pitched chords / notes — the original warm FM "plucked-electric" patch
 *     (Tone.PolySynth of FM sines through a low-pass + chorus + reverb). Chords
 *     are voiced low→high and strummed with a short per-string micro-delay so a
 *     click reads as a downstroke, not a block. An optional Tone.Sampler can
 *     replace it if real samples are provided (see loadSampler()).
 *
 *  2. Muted "chucks" for the Strumming Studio — NOT a drum hit. We rake a set of
 *     heavily-choked (very short, low-resonance) plucked strings across the neck
 *     with a tight micro-stagger, plus a pick "scratch", to get the percussive
 *     "trrr" of all strings strummed while muted. Down = full low→high rake,
 *     Up = lighter, brighter high→low rake.
 */

/* ------------------------------------------------------------------ */
/* Graph                                                              */
/* ------------------------------------------------------------------ */

let synth = null // melodic FM PolySynth (the "electric-piano-ish" guitar)
let sampler = null // optional real-sample upgrade
let usingSampler = false
let melodicIn = null // input node of the melodic chain (filter)

let chuckVoices = [] // choked PluckSynth pool for the muted rake
let downScratch = null
let upScratch = null
let percOut = null // dry-ish percussion bus

let chime = null

let booting = null
let ready = false

async function boot() {
  if (ready) return
  if (booting) return booting
  booting = (async () => {
    await Tone.start()

    /* --- Melodic chain (restored original tone) --------------------- */
    const reverb = new Tone.Reverb({ decay: 1.6, wet: 0.22 }).toDestination()
    const chorus = new Tone.Chorus(2.4, 2.5, 0.25).start()
    const filter = new Tone.Filter(3600, 'lowpass')
    filter.chain(chorus, reverb)
    melodicIn = filter

    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fmsine', modulationType: 'triangle', modulationIndex: 1.6 },
      envelope: { attack: 0.006, decay: 0.9, sustain: 0.15, release: 1.4 },
      volume: -10,
    })
    synth.connect(melodicIn)

    /* --- Percussion bus (muted chucks) ------------------------------ */
    // Dry and punchy — no big reverb tail, just a touch of body.
    percOut = new Tone.Gain(1.5).toDestination()

    // Heavily choked strings: short, low resonance → a "chk", not a ring.
    chuckVoices = Array.from({ length: 6 }, () => {
      const p = new Tone.PluckSynth({
        attackNoise: 3, // lots of pick noise → the "trrr" rasp
        dampening: 2200, // darker, deadened
        resonance: 0.42, // low sustain = muted
        release: 0.12,
      })
      p.volume.value = 3
      p.connect(percOut)
      return p
    })

    // Pick "scratch" that rides on top of the rake.
    const mkScratch = ({ freq, q, type, vol }) => {
      const bp = new Tone.Filter({ type: 'bandpass', frequency: freq, Q: q })
      const n = new Tone.NoiseSynth({
        noise: { type },
        envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
      })
      n.volume.value = vol
      n.chain(bp, percOut)
      return n
    }
    downScratch = mkScratch({ freq: 380, q: 1.0, type: 'pink', vol: -3 })
    upScratch = mkScratch({ freq: 720, q: 1.3, type: 'white', vol: -6 })

    /* --- "In tune!" chime ------------------------------------------- */
    chime = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.35, sustain: 0, release: 0.4 },
    })
    chime.volume.value = -12
    chime.connect(reverb)

    ready = true
    loadSampler() // fire-and-forget optional upgrade
  })()
  return booting
}

/* ------------------------------------------------------------------ */
/* Optional sampler upgrade (real acoustic samples)                    */
/* ------------------------------------------------------------------ */
async function loadSampler() {
  try {
    const res = await fetch('/samples/guitar-acoustic/manifest.json', { cache: 'no-store' })
    if (!res.ok) return
    const map = await res.json()
    if (!map || typeof map !== 'object' || !Object.keys(map).length) return
    await new Promise((resolve, reject) => {
      sampler = new Tone.Sampler({
        urls: map,
        baseUrl: '/samples/guitar-acoustic/',
        release: 1.2,
        onload: resolve,
        onerror: reject,
      })
      sampler.connect(melodicIn)
    })
    usingSampler = true
  } catch {
    usingSampler = false
    sampler = null
  }
}

/* ------------------------------------------------------------------ */
/* Voicing                                                             */
/* ------------------------------------------------------------------ */
export function voiceChord(symbol) {
  const p = parseChord(symbol)
  if (!p) return []
  const info = Chord.get(symbol.split('/')[0])
  const pcs = info.notes && info.notes.length ? info.notes : [p.tonic]
  const bass = symbol.split('/')[1] || null

  const octave = 2
  const notes = []
  pcs.forEach((n, i) => notes.push(`${n}${octave + (i >= 3 ? 1 : 0)}`))
  notes.push(`${pcs[0]}${octave + 2}`)
  if (pcs[1]) notes.push(`${pcs[1]}${octave + 2}`)

  let midi = notes.map((n) => ({ n, m: Note.midi(n) })).filter((x) => x.m != null)
  if (bass) {
    const bm = Note.midi(`${bass}2`)
    if (bm != null) midi.unshift({ n: `${bass}2`, m: bm })
  }

  midi.sort((a, b) => a.m - b.m)
  const seen = new Set()
  const ordered = midi.filter((x) => (seen.has(x.m) ? false : seen.add(x.m)))
  return ordered.slice(0, 6).map((x) => x.n)
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Strum a chord low→high (down) or high→low (up) with a strum micro-delay. */
export async function playChord(symbol, { direction = 'down', velocity = 0.85 } = {}) {
  await boot()
  const notes = voiceChord(symbol)
  if (!notes.length) return
  const ordered = direction === 'up' ? [...notes].reverse() : notes
  const now = Tone.now() + 0.02
  const stagger = 0.028
  const src = usingSampler && sampler ? sampler : synth
  ordered.forEach((note, i) => {
    const v = velocity * (0.82 + Math.random() * 0.18)
    src.triggerAttackRelease(note, '2n', now + i * stagger, v)
  })
}

/* ------------------------------------------------------------------ */
/* Sustained chord — held down until explicitly released.              */
/* Used by AR Studio: the chord rings out for as long as your finger   */
/* stays on it, then stops the instant you pull away.                  */
/* ------------------------------------------------------------------ */
let heldSrc = null
let heldNotes = []

/** Strum a chord and HOLD it (no auto-release). Replaces any prior held chord. */
export async function startChord(symbol, { direction = 'down', velocity = 0.8 } = {}) {
  await boot()
  const notes = voiceChord(symbol)
  if (!notes.length) return
  releaseChord() // cut the previous sustained chord first
  const src = usingSampler && sampler ? sampler : synth
  const now = Tone.now() + 0.02
  const stagger = 0.022
  const ordered = direction === 'up' ? [...notes].reverse() : notes
  ordered.forEach((note, i) => {
    const v = velocity * (0.82 + Math.random() * 0.18)
    src.triggerAttack(note, now + i * stagger, v)
  })
  heldSrc = src
  heldNotes = notes
}

/** Release whatever sustained chord is currently ringing. */
export function releaseChord() {
  if (!heldSrc) return
  const src = heldSrc
  const notes = heldNotes
  heldSrc = null
  heldNotes = []
  try {
    src.triggerRelease(notes, Tone.now() + 0.02)
  } catch {
    src.releaseAll?.()
  }
}

/** Play a single pitched note (fretboard taps, references). */
export async function playNote(note, dur = '4n', velocity = 0.9) {
  await boot()
  const src = usingSampler && sampler ? sampler : synth
  src.triggerAttackRelease(note, dur, Tone.now() + 0.01, velocity)
}

/**
 * Muted strum ("chuck"). Rakes choked strings across the neck for a percussive
 * "trrr", louder and stringy — not a drum hit. `up` gives a lighter, brighter,
 * high→low rake.
 */
export async function playChuck({ up = false } = {}) {
  await boot()
  const t = Tone.now() + 0.005
  // Down rakes all 6 low→high; up is lighter — top 5 strings high→low.
  const strings = up
    ? ['E4', 'B3', 'G3', 'D3', 'A2']
    : ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']
  const stagger = up ? 0.005 : 0.006
  strings.forEach((n, i) => chuckVoices[i % chuckVoices.length].triggerAttack(n, t + i * stagger))
  ;(up ? upScratch : downScratch).triggerAttackRelease(0.05, t, up ? 0.7 : 0.95)
}

/** Short "you're in tune" bell (perfect-fifth ding). */
export async function playTunedChime() {
  await boot()
  const t = Tone.now() + 0.01
  chime.triggerAttackRelease('E5', 0.18, t, 0.9)
  chime.triggerAttackRelease('B5', 0.5, t + 0.12, 0.8)
}

export function isAudioReady() {
  return ready
}
export function isUsingSamples() {
  return usingSampler
}
