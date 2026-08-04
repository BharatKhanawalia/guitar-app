import * as Tone from 'tone'
import { Chord, Note } from 'tonal'
import { parseChord } from './chordTheory'
import { isAudioAllowed, isAudioRunning, withTimeout } from './audioUnlock'

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
let sampler = null // real acoustic samples — natural, ringing release for everything
let usingSampler = false
let samplerReady = null // promise that resolves once the sample-load attempt is done
let melodicIn = null // input node of the melodic chain (filter → chorus → reverb)
let acousticIn = null // DRY acoustic bus (no chorus, tiny room) for sampled strums

let chuckVoices = [] // choked PluckSynth pool for the muted rake
let strumVoices = [] // RINGING PluckSynth pool for acoustic-style chord strums
let downScratch = null
let upScratch = null
let slap = null // "thumb slap" body thump (MembraneSynth)
let slapNoise = null // slap transient noise
let percOut = null // dry-ish percussion bus

let chime = null

let masterAnalyser = null // taps all output buses → level metering / audio tests

let booting = null
let ready = false

/**
 * Build the audio graph, resuming the context first.
 *
 * Returns TRUE only when audio will actually be heard. Callers must bail on
 * false instead of scheduling: before the user's first gesture the context is
 * suspended, its clock is frozen, and anything scheduled would pile up and fire
 * as one burst whenever the context later resumes. See ./audioUnlock.js.
 */
async function boot() {
  if (!isAudioAllowed()) return false // no gesture yet → drop the sound, never queue it
  if (ready) return isAudioRunning()
  if (booting) {
    await booting
    return ready && isAudioRunning()
  }
  booting = (async () => {
    // We're inside/just after a gesture, so this resume can settle. The timeout
    // is belt-and-braces: a resume that stalls anyway must not latch `booting`
    // pending forever — that is what turned every early sound into a queue.
    await withTimeout(Tone.start().catch(() => {}), 4000)

    /* --- Melodic chain (restored original tone) --------------------- */
    const reverb = new Tone.Reverb({ decay: 1.6, wet: 0.22 }).toDestination()
    const chorus = new Tone.Chorus(2.4, 2.5, 0.25).start()
    const filter = new Tone.Filter(3600, 'lowpass')
    filter.chain(chorus, reverb)
    melodicIn = filter

    // DRY acoustic bus for real-sample / plucked strums: NO chorus (that shimmer
    // is what read as "electronic"), just a gentle top rolloff and a tiny room so
    // notes decay naturally and consecutive strums stay separate.
    const acReverb = new Tone.Reverb({ decay: 1.0, wet: 0.09 }).toDestination()
    const acFilter = new Tone.Filter(6500, 'lowpass')
    acFilter.connect(acReverb)
    acousticIn = acFilter

    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fmsine', modulationType: 'triangle', modulationIndex: 1.6 },
      envelope: { attack: 0.006, decay: 0.9, sustain: 0.15, release: 1.4 },
      volume: -10,
    })
    synth.connect(melodicIn)

    /* --- Percussion bus (muted chucks) ------------------------------ */
    // Dry and punchy — no big reverb tail, just a touch of body.
    percOut = new Tone.Gain(0.9).toDestination() // was 1.5 — that clipped on rakes

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

    // Ringing plucked strings (Karplus-Strong) — the FALLBACK when no real samples
    // are installed. Tuned for natural DECAY (not endless sustain) so consecutive
    // strums separate cleanly, and routed through the dry acoustic bus (no chorus).
    strumVoices = Array.from({ length: 6 }, () => {
      const p = new Tone.PluckSynth({
        attackNoise: 1.0, // a little pick noise, not a rasp
        dampening: 3400, // slightly darker → less "digital" edge
        resonance: 0.85, // natural, ringing decay (no artificial choking)
        release: 0.8,
      })
      p.volume.value = -5
      p.connect(acousticIn)
      return p
    })

    // "Thumb slap" — a brief percussive thump on the body/strings (muted-mode ✕).
    slap = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.08 },
    })
    slap.volume.value = -2
    slap.connect(percOut)
    slapNoise = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.02 },
    })
    slapNoise.volume.value = -9
    slapNoise.connect(percOut)

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

    // Tap every output bus so we can meter total output (and prove sound flows).
    masterAnalyser = new Tone.Analyser('waveform', 256)
    reverb.connect(masterAnalyser)
    acReverb.connect(masterAnalyser)
    percOut.connect(masterAnalyser)

    ready = true
    samplerReady = loadSampler() // kick off the real-sample upgrade; awaited by pitched voices
  })().catch((err) => {
    // A failed boot must not poison every later call — clear the latch so the
    // next gesture gets a fresh attempt.
    console.warn('audioEngine boot failed:', err)
    booting = null
    ready = false
  })
  await booting
  return ready && isAudioRunning()
}

/**
 * Boot AND wait for the acoustic-sample load attempt to finish. Pitched voices
 * use this instead of boot() so the VERY FIRST chord already plays the real
 * guitar samples — never the FM-synth fallback while samples are still loading.
 * If no samples are installed, samplerReady resolves fast and we use the synth.
 * Like boot(), returns false when the sound must be dropped.
 */
async function ensureSamples() {
  if (!(await boot())) return false
  if (samplerReady) {
    try {
      await samplerReady
    } catch {
      /* sample load failed → fall back to the synth, nothing else to do */
    }
  }
  return isAudioRunning()
}

/** RMS of the strumming engine's output (0..1) — metering + audio self-tests. */
export function getMasterLevel() {
  if (!masterAnalyser) return 0
  const buf = masterAnalyser.getValue()
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
  return Math.sqrt(s / buf.length)
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
        release: 0.8, // long, natural release — the strings ring out, no choking
        onload: resolve,
        onerror: reject,
      })
      sampler.connect(acousticIn) // dry bus → real, close-mic'd acoustic tone
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
  if (!(await ensureSamples())) return
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

/**
 * Play a chord SHAPE as it sounds with a capo — i.e. its actual open-shape voicing
 * moved up `semitones` frets, note-for-note. This is NOT the same as playing the
 * transposed chord's own open voicing: an A shape at capo 3 rings out as a C, but
 * voiced (register + string spacing) like an A, so it sounds subtly different from
 * an open C. `semitones = 0` is identical to playChord().
 */
export async function playChordShifted(symbol, semitones = 0, { direction = 'down', velocity = 0.85 } = {}) {
  if (!semitones) return playChord(symbol, { direction, velocity })
  if (!(await ensureSamples())) return
  const notes = voiceChord(symbol)
    .map((n) => { const m = Note.midi(n); return m == null ? null : Note.fromMidi(m + semitones) })
    .filter(Boolean)
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
  if (!(await ensureSamples())) return
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
  if (!(await ensureSamples())) return
  const src = usingSampler && sampler ? sampler : synth
  src.triggerAttackRelease(note, dur, Tone.now() + 0.01, velocity)
}

/**
 * Muted strum ("chuck"). Rakes choked strings across the neck for a percussive
 * "trrr" — not a drum hit. Down is full/darker (all 6, low→high); up is lighter
 * and brighter (top strings, high→low). Slower & more detailed than a click:
 * a wider stagger reads clearly as a hand sweeping the strings.
 */
export async function playChuck({ up = false, velocity = 0.9, count = null, time = 0 } = {}) {
  if (!(await boot())) return
  const t = Tone.now() + 0.005 + Math.max(0, time) // `time` = humanized micro-shift
  let strings = up
    ? ['E4', 'B3', 'G3', 'D3'] // up: lighter, top strings, high→low
    : ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] // down: full rake, low→high
  if (count) strings = strings.slice(0, Math.max(2, Math.min(count, strings.length)))
  const stagger = up ? 0.012 : 0.016 // wider than before → a real "sweep"
  strings.forEach((n, i) => {
    chuckVoices[i % chuckVoices.length].triggerAttack(n, t + i * stagger, velocity * (up ? 0.75 : 1))
  })
  ;(up ? upScratch : downScratch).triggerAttackRelease(0.06, t, velocity * (up ? 0.6 : 0.95))
}

/**
 * Acoustic chord strum for the Strumming Studio's "Play Chord" mode.
 * Down = full ringing rake low→high (wide stagger, longer sustain).
 * Up   = lighter, brighter, high→low across the top strings, slightly higher
 *        velocity feel — as a real up-stroke catches fewer, higher strings.
 * Uses the real sampler when samples are installed, else ringing pluck voices.
 */
export async function playAcousticStrum(
  symbol,
  { up = false, velocity = 0.85, strings = null, sustain = null, spread = null, time = 0 } = {},
) {
  if (!(await ensureSamples())) return
  const voiced = voiceChord(symbol)
  if (!voiced.length) return
  // RHYTHM VOICING: catch only the TOP strings — dropping the heavy bass keeps a
  // rhythm strum from dominating. Down and up use the SAME top strings, differing
  // only in sweep direction (down = low→high, up = high→low) and count.
  const n = Math.max(2, Math.min(strings ?? (up ? 3 : 4), voiced.length))
  const top = voiced.slice(-n) // top n strings, low→high
  const ordered = up ? [...top].reverse() : top
  const now = Tone.now() + 0.02 + Math.max(0, time)
  // "Brief & distinguishable" comes from a FAST SWEEP (tight per-string micro-
  // delay), NOT from choking. Each stroke reads as a crisp attack, then the
  // strings ring out NATURALLY (long sampler release) — no dampening, no fade.
  const stagger = spread ?? (up ? 0.009 : 0.012)
  const dur = sustain ?? '1n' // let it ring
  const useSamp = usingSampler && sampler
  ordered.forEach((note, i) => {
    // Downs are voiced as light as ups (same 0.78 multiplier) so a rhythm down
    // no longer reads as a heavy, over-defined accent.
    const v = Math.min(1, velocity * 0.78 * (0.9 + Math.random() * 0.1))
    const t = now + 0.006 + i * stagger
    if (useSamp) sampler.triggerAttackRelease(note, dur, t, v)
    else strumVoices[i % strumVoices.length].triggerAttack(note, t, v)
  })
}

/** Short muted string scratch — the ✕ in "Play Chord" mode (dead-string rake). */
export async function playStringMute({ velocity = 0.7, time = 0 } = {}) {
  if (!(await boot())) return
  const t = Tone.now() + 0.005 + Math.max(0, time)
  const strings = ['A2', 'D3', 'G3', 'B3']
  strings.forEach((n, i) => chuckVoices[i % chuckVoices.length].triggerAttack(n, t + i * 0.008, velocity))
  downScratch.triggerAttackRelease(0.05, t, velocity)
}

/** Brief percussive "thumb slap" on the body/strings — the ✕ in muted mode. */
export async function playThumbSlap({ velocity = 0.95, time = 0 } = {}) {
  if (!(await boot())) return
  const t = Tone.now() + 0.005 + Math.max(0, time)
  slap.triggerAttackRelease('B1', 0.12, t, velocity)
  slapNoise.triggerAttackRelease(0.03, t, velocity * 0.75)
}

/** Short "you're in tune" bell (perfect-fifth ding). */
export async function playTunedChime() {
  if (!(await boot())) return
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

// Dev-only handle so automated tests can read output level & sampler status.
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  window.__capoAudio = { getMasterLevel, isUsingSamples, isAudioReady }
}
