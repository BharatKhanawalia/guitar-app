import * as Tone from 'tone'
import { Chord, Scale, Note } from 'tonal'
import { withTimeout } from './audioUnlock'

/**
 * arSynth.js — the AR Studio instrument engine.
 *
 *  • "Woo" is SYNTHESIZED from scratch as a formant (vowel "oo") choir pad — a
 *    detuned saw run through three band-pass formant filters — so it captures the
 *    exact timbre with none of the radio artifacts / baked-in chords of the raw
 *    recording. It sustains forever while a gesture is held.
 *  • Every real instrument (piano, harmonium, organ, violin, cello, harp, flute,
 *    sax, guitars…) uses actual recorded multisamples (tonejs-instruments CDN +
 *    the bundled acoustic-guitar set), mapped across the keyboard via Tone.Sampler
 *    so each one truly sounds like itself.
 *  • Shared filter → vibrato → chorus → reverb → volume → limiter bus. Master
 *    volume defaults to 0 dB (max); the limiter keeps it clean.
 */

/* ------------------------------------------------------------------ */
/* Real-sample note maps (octaves 2–5; Tone.Sampler interpolates)      */
/* ------------------------------------------------------------------ */
const CDN = 'https://nbrosowsky.github.io/tonejs-instruments/samples/'
const SAMPLE_MAPS = {
  piano: ['A2','A3','A4','A5','C2','C3','C4','C5','D#2','D#3','D#4','D#5','F#2','F#3','F#4','F#5'],
  harmonium: ['C2','C3','C4','C5','D#2','D#3','D#4','F#2','F#3','A2','A3','A4'],
  organ: ['C2','C3','C4','C5','D#2','D#3','D#4','F#2','F#3','F#4','A2','A3','A4'],
  harp: ['C3','C5','D2','D4','F2','F4','A2','A4','B3','B5'],
  violin: ['A3','A4','C4','C5','E4','G4','G5'],
  cello: ['C2','C3','C4','E3','E4','G2','G3','A2','A3'],
  flute: ['C4','C5','E4','E5','A4','A5'],
  saxophone: ['C4','C5','D#3','D#4','F3','F4','G3','G4','A4','A#3'],
  'guitar-electric': ['C3','C4','C5','D#3','D#4','E2','F#2','F#3','A2','A3','A4'],
}
const noteToFile = (n) => n.replace('#', 's') + '.mp3'
function urlsFor(list) {
  const u = {}
  for (const n of list) u[n] = noteToFile(n)
  return u
}

/* ------------------------------------------------------------------ */
/* Instrument presets — mostly REAL samples, a few synth voices        */
/* ------------------------------------------------------------------ */
// kind: 'woo' formant pad · 'sample' real multisample · 'synth' Tone voice.
export const INSTRUMENTS = {
  // Exact replica of sound.gojaehyun.com's pad: a gliding oscillator bank →
  // ~1.8 kHz lowpass, DRY (no reverb/chorus) for its loud, sharp character.
  woo: { label: 'Woo (default)', kind: 'woo', filter: 1800, chorus: 0, reverb: 0 },
  piano: { label: 'Grand Piano', kind: 'sample', src: CDN + 'piano/', urls: urlsFor(SAMPLE_MAPS.piano), release: 1.2, filter: 12000, chorus: 0.08, reverb: 0.28 },
  epiano: {
    label: 'Electric Piano', kind: 'synth', voice: 'FMSynth',
    options: { harmonicity: 3, modulationIndex: 12, oscillator: { type: 'sine' }, envelope: { attack: 0.002, decay: 1.6, sustain: 0.08, release: 1.1 }, modulation: { type: 'sine' }, modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.1, release: 0.3 } },
    filter: 5200, chorus: 0.3, reverb: 0.35, trem: 0.12,
  },
  guitar: { label: 'Acoustic Guitar', kind: 'sample', src: '/samples/guitar-acoustic/', manifest: true, strum: true, release: 1.2, filter: 12000, chorus: 0.1, reverb: 0.28 },
  guitarE: { label: 'Electric Guitar', kind: 'sample', src: CDN + 'guitar-electric/', urls: urlsFor(SAMPLE_MAPS['guitar-electric']), strum: true, release: 1.4, filter: 11000, chorus: 0.15, reverb: 0.3 },
  harmonium: { label: 'Harmonium', kind: 'sample', src: CDN + 'harmonium/', urls: urlsFor(SAMPLE_MAPS.harmonium), release: 0.5, filter: 12000, chorus: 0.12, reverb: 0.3 },
  organ: { label: 'Organ', kind: 'sample', src: CDN + 'organ/', urls: urlsFor(SAMPLE_MAPS.organ), release: 0.3, filter: 12000, chorus: 0.2, reverb: 0.28 },
  violin: { label: 'Violin', kind: 'sample', src: CDN + 'violin/', urls: urlsFor(SAMPLE_MAPS.violin), release: 0.8, filter: 12000, chorus: 0.15, reverb: 0.4 },
  cello: { label: 'Cello', kind: 'sample', src: CDN + 'cello/', urls: urlsFor(SAMPLE_MAPS.cello), release: 0.9, filter: 12000, chorus: 0.15, reverb: 0.42 },
  harp: { label: 'Harp', kind: 'sample', src: CDN + 'harp/', urls: urlsFor(SAMPLE_MAPS.harp), release: 1.6, filter: 12000, chorus: 0.12, reverb: 0.45 },
  flute: { label: 'Flute', kind: 'sample', src: CDN + 'flute/', urls: urlsFor(SAMPLE_MAPS.flute), release: 0.6, filter: 12000, chorus: 0.12, reverb: 0.4 },
  sax: { label: 'Saxophone', kind: 'sample', src: CDN + 'saxophone/', urls: urlsFor(SAMPLE_MAPS.saxophone), release: 0.5, filter: 12000, chorus: 0.12, reverb: 0.35 },
  // Aurora = a DARK, WET, slow-swelling sine pad (ambient).
  aurora: {
    label: 'Aurora Pad', kind: 'synth', voice: 'Synth',
    options: { oscillator: { type: 'fatsine', count: 3, spread: 24 }, envelope: { attack: 1.2, decay: 0.6, sustain: 1, release: 2.6 } },
    filter: 1600, chorus: 0.8, reverb: 0.75,
  },
  // Synth Lead = a BRIGHT, DRY, punchy detuned-saw lead (very different from Aurora).
  synth: {
    label: 'Synth Lead', kind: 'synth', voice: 'Synth',
    options: { oscillator: { type: 'fatsawtooth', count: 3, spread: 48 }, envelope: { attack: 0.008, decay: 0.18, sustain: 0.7, release: 0.35 } },
    filter: 5200, chorus: 0.15, reverb: 0.1,
  },
}
export const INSTRUMENT_KEYS = Object.keys(INSTRUMENTS)

export const SCALES = { Major: 'major', Minor: 'minor', Pentatonic: 'minor pentatonic', Blues: 'blues', Chromatic: 'chromatic' }
export const WAVES = ['sine', 'triangle', 'sawtooth', 'square']

/* ------------------------------------------------------------------ */
/* Shared FX bus                                                       */
/* ------------------------------------------------------------------ */
let filter, vibrato, tremolo, chorus, reverb, masterVol, limiter, meter, recDest
let current = null
let currentName = 'woo'
let ready = false
let booting = null
let waveOverride = null
let heldChord = []
let heldNote = null

const VOICE_CLASS = { Synth: Tone.Synth, FMSynth: Tone.FMSynth, AMSynth: Tone.AMSynth }

/* ---- factories: uniform { triggerAttack, triggerRelease, releaseAll, dispose } ---- */
function makeSynth(preset) {
  const Voice = VOICE_CLASS[preset.voice] || Tone.Synth
  let options = preset.options
  if (waveOverride && preset.voice === 'Synth' && options.oscillator && !options.oscillator.partials) {
    const t = options.oscillator.count ? 'fat' + waveOverride : waveOverride
    options = { ...options, oscillator: { ...options.oscillator, type: t } }
  }
  const poly = new Tone.PolySynth(Voice, options)
  poly.maxPolyphony = 16
  poly.connect(filter)
  return {
    triggerAttack: (n, t) => poly.triggerAttack(n, t),
    triggerRelease: (n, t) => poly.triggerRelease(n, t),
    releaseAll: () => poly.releaseAll(),
    dispose: () => poly.dispose(),
  }
}

async function makeSampler(preset) {
  let urls = preset.urls
  if (preset.manifest) {
    const res = await fetch(preset.src + 'manifest.json', { cache: 'force-cache' })
    urls = await res.json()
  }
  const sampler = await new Promise((resolve, reject) => {
    const s = new Tone.Sampler({ urls, baseUrl: preset.src, release: preset.release || 1, onload: () => resolve(s), onerror: reject })
  })
  sampler.connect(filter)
  const strum = !!preset.strum
  const STAG = 0.022 // per-string micro-delay for a real downstroke rake
  // For a strummed instrument (acoustic AND electric guitar), voice a full 5-6
  // string chord: a bass root an octave below + a high root an octave above the
  // triad, so a locked chord reads as a rich strum, not a thin single note.
  const voice = (notes) => {
    const arr = Array.isArray(notes) ? notes : [notes]
    if (!strum || arr.length < 2) return arr
    const lowM = Note.midi(arr[0])
    const out = arr.slice()
    if (lowM != null) out.unshift(Note.fromMidi(lowM - 12)) // low bass string
    if (lowM != null) out.push(Note.fromMidi(lowM + 12)) // high jangly octave
    return out
  }
  return {
    triggerAttack: (notes, t) => {
      const v = voice(notes)
      const t0 = t || Tone.now()
      v.forEach((n, i) => sampler.triggerAttack(n, t0 + 0.006 + (strum ? i * STAG : 0)))
    },
    triggerRelease: (notes, t) => sampler.triggerRelease(voice(notes), t),
    releaseAll: () => sampler.releaseAll(),
    dispose: () => sampler.dispose(),
  }
}

// Exact replica of sound.gojaehyun.com's synth: a FIXED bank of oscillators that
// never restart. Changing chord GLIDES each oscillator's frequency (portamento)
// and swells the gain — so transitions are seamless with no re-trigger break, and
// the first chord "starts low and catches" as the oscillators sweep up from rest.
// Dry (no reverb/chorus) → the loud, sharp character of the reference.
const WOO_LEVEL = 0.34 // per-voice; sums through the limiter for a loud, present pad
const MAX_CHORD_VOICES = 6
function makeWoo() {
  const wtype = () => waveOverride || 'triangle'
  let bank = [] // persistent chord oscillators {osc, gain}
  let mel = null // persistent melody oscillator
  const mkVoice = () => {
    const gain = new Tone.Gain(0).connect(filter)
    const osc = new Tone.Oscillator(220, wtype()).connect(gain)
    osc.start()
    return { osc, gain }
  }
  const ensureBank = () => { if (!bank.length) bank = Array.from({ length: MAX_CHORD_VOICES }, mkVoice) }
  // exponentialRampTo glides pitch at constant cents/sec → a musical, audibly
  // CONNECTED portamento between chords. A voice that was silent swells in with a
  // gentle curved fade (setTargetAtTime), so the attack from zero is smooth, not a
  // hard step. GLIDE_S is a touch longer for a clearly connected slide.
  const GLIDE_S = 0.18
  const FADE_S = 0.12
  const swellIn = (g) => {
    // If the voice is essentially silent, ease it in with a smooth exponential
    // approach (beautiful fade-in curve); otherwise just hold the level.
    if (g.gain.value < 0.02) g.gain.setTargetAtTime(WOO_LEVEL, Tone.now(), FADE_S / 3)
    else g.gain.rampTo(WOO_LEVEL, FADE_S)
  }
  const attackChord = (notes) => {
    ensureBank()
    notes.slice(0, MAX_CHORD_VOICES).forEach((n, i) => {
      const f = Note.freq(n)
      if (f) {
        bank[i].osc.frequency.exponentialRampTo(f, GLIDE_S) // connected pitch glide
        swellIn(bank[i].gain)
      }
    })
    for (let i = notes.length; i < MAX_CHORD_VOICES; i++) bank[i].gain.gain.rampTo(0, 0.1)
  }
  const attackMel = (n) => {
    if (!mel) mel = mkVoice()
    const f = Note.freq(n)
    if (f) {
      mel.osc.frequency.exponentialRampTo(f, 0.08)
      swellIn(mel.gain)
    }
  }
  const disposeVoice = (v) => { try { v.osc.stop(); v.osc.dispose(); v.gain.dispose() } catch { /* disposed */ } }
  return {
    glide: true, // tells holdChord/holdNote to transition seamlessly (no pre-release)
    triggerAttack: (notes) => (Array.isArray(notes) ? attackChord(notes) : attackMel(notes)),
    triggerRelease: (notes) => {
      if (Array.isArray(notes)) bank.forEach((v) => v.gain.gain.rampTo(0, 0.08))
      else if (mel) mel.gain.gain.rampTo(0, 0.06)
    },
    releaseAll: () => { bank.forEach((v) => v.gain.gain.rampTo(0, 0.08)); if (mel) mel.gain.gain.rampTo(0, 0.06) },
    dispose: () => { bank.forEach(disposeVoice); if (mel) disposeVoice(mel); bank = []; mel = null },
  }
}

async function buildInstrument(name) {
  const preset = INSTRUMENTS[name] || INSTRUMENTS.woo
  filter.frequency.rampTo(preset.filter || 6000, 0.1)
  chorus.wet.rampTo(preset.chorus || 0, 0.1)
  reverb.wet.value = preset.reverb || 0.3
  vibrato.depth.rampTo(preset.vib || 0, 0.1)
  tremolo.depth.rampTo(preset.trem || 0, 0.1)
  try {
    if (preset.kind === 'woo') return makeWoo()
    if (preset.kind === 'sample') return await makeSampler(preset)
    return makeSynth(preset)
  } catch (e) {
    // A sample set that fails to load (offline / CDN) must never kill the studio.
    console.warn('Instrument load failed, using synth pad:', name, e)
    return makeSynth(INSTRUMENTS.aurora)
  }
}

export async function boot() {
  if (ready) return
  if (booting) return booting
  booting = (async () => {
    // Never await a resume that may never settle: outside a user gesture the
    // browser leaves ctx.resume() pending forever, which would latch `booting`
    // and stall every caller behind it (see ./audioUnlock.js). The studio is
    // always entered by a click, so this normally resolves at once.
    await withTimeout(Tone.start().catch(() => {}), 4000)
    limiter = new Tone.Limiter(-1).toDestination()
    meter = new Tone.Meter({ smoothing: 0.85 }) // real output level (dB) for the HUD
    limiter.connect(meter)
    masterVol = new Tone.Volume(0).connect(limiter)
    reverb = new Tone.Reverb({ decay: 4, wet: 0.5 }).connect(masterVol)
    chorus = new Tone.Chorus(1.2, 3.5, 0.5).start().connect(reverb)
    tremolo = new Tone.Tremolo(5.2, 0).start().connect(chorus)
    vibrato = new Tone.Vibrato(5, 0).connect(tremolo)
    filter = new Tone.Filter(6000, 'lowpass').connect(vibrato)
    current = await buildInstrument(currentName)
    ready = true
  })()
  return booting
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */
export async function setInstrument(name) {
  if (!INSTRUMENTS[name]) return
  currentName = name
  await boot()
  const old = current
  current = await buildInstrument(name)
  heldChord = []
  heldNote = null
  try { old?.dispose() } catch { /* noop */ }
}

export async function setWave(w) {
  waveOverride = WAVES.includes(w) ? w : null
  if (!ready) return
  const old = current
  current = await buildInstrument(currentName)
  heldChord = []
  heldNote = null
  try { old?.dispose() } catch { /* noop */ }
}

export function setVolume(db) {
  if (masterVol) masterVol.volume.rampTo(db, 0.05)
}

export async function holdChord(notes) {
  await boot()
  if (!current) current = await buildInstrument(currentName)
  if (!notes || !notes.length) return
  if (!current.glide) releaseChord() // gliding voices sweep to the new chord; no break
  current.triggerAttack(notes, Tone.now() + 0.01)
  heldChord = notes
}
export function releaseChord() {
  if (!current || !heldChord.length) return
  try { current.triggerRelease(heldChord, Tone.now() + 0.01) } catch { current.releaseAll?.() }
  heldChord = []
}

export async function holdNote(note) {
  await boot()
  if (!current) current = await buildInstrument(currentName)
  if (note === heldNote) return
  if (!current.glide) releaseNote() // gliding melody voice slides to the new note
  current.triggerAttack(note, Tone.now() + 0.005)
  heldNote = note
}
export function releaseNote() {
  if (!current || !heldNote) return
  try { current.triggerRelease(heldNote, Tone.now() + 0.005) } catch { current.releaseAll?.() }
  heldNote = null
}

export function stopAll() {
  releaseChord()
  releaseNote()
  try { current?.releaseAll?.() } catch { /* noop */ }
}

/* ------------------------------------------------------------------ */
/* Music helpers                                                       */
/* ------------------------------------------------------------------ */
export function chordNotes(root, suffix, octave = 3) {
  const info = Chord.get(root + suffix)
  const names = info.notes && info.notes.length ? info.notes : [root]
  const pcs = names.map((n) => Note.chroma(n)).filter((c) => c != null)
  if (!pcs.length) return []

  // Match sound.gojaehyun.com: root sits at C{octave} + its pitch class (the wheel
  // ascends C→B within the octave), chord tones stacked upward. Big root jumps are
  // handled musically by the portamento GLIDE (see makeWoo), like the reference.
  let prev = (Note.midi('C' + octave) ?? 48) + pcs[0]
  const out = [Note.fromMidi(prev)]
  for (let i = 1; i < pcs.length; i++) {
    const prevPc = ((prev % 12) + 12) % 12
    let step = (((pcs[i] - prevPc) % 12) + 12) % 12
    if (step === 0) step = 12 // always stack upward, no unison duplicates
    prev += step
    out.push(Note.fromMidi(prev))
  }
  return out
}

export function scaleNotes(tonic, scaleName, octaves = 2, startOctave = 3) {
  const intervals = Scale.get(`${tonic} ${scaleName}`).notes
  if (!intervals.length) return []
  const out = []
  for (let o = 0; o < octaves; o++) {
    for (const pc of intervals) {
      const midi = Note.midi(pc + (startOctave + o))
      if (midi != null) out.push(Note.fromMidi(midi))
    }
  }
  const top = Note.midi(tonic + (startOctave + octaves))
  if (top != null) out.push(Note.fromMidi(top))
  return out
}

export function isReady() {
  return ready
}

/** Real output level in dB (from the master meter), or -Infinity when silent/unbooted. */
export function getLevel() {
  if (!meter) return -Infinity
  const v = meter.getValue()
  return typeof v === 'number' ? v : -Infinity
}

/** A live MediaStream of the master audio output (for recording). Lazily tapped. */
export function getAudioStream() {
  if (!ready || !limiter) return null
  if (!recDest) {
    recDest = Tone.getContext().rawContext.createMediaStreamDestination()
    limiter.connect(recDest)
  }
  return recDest.stream
}

let micNode = null
let micGain = null

/** Mix a microphone stream INTO the recording tap only (captured, not played back —
 *  so your singing is recorded alongside the instruments with no speaker feedback).
 *  The voice is lifted a touch so it sits alongside the instruments. */
export function attachMic(micStream) {
  if (!ready) return
  detachMic()
  const raw = Tone.getContext().rawContext
  if (!recDest) {
    recDest = raw.createMediaStreamDestination()
    limiter.connect(recDest)
  }
  micNode = raw.createMediaStreamSource(micStream)
  micGain = raw.createGain()
  micGain.gain.value = 2.2 // lift a typically-quiet mic up near the instruments
  micNode.connect(micGain)
  micGain.connect(recDest) // → recording only, NOT to speakers
}

export function detachMic() {
  for (const n of [micNode, micGain]) { try { n?.disconnect() } catch { /* noop */ } }
  micNode = micGain = null
}
