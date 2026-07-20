import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  playChuck,
  playAcousticStrum,
  playStringMute,
  playThumbSlap,
} from '../lib/audioEngine'
import { rangeFill } from '../lib/ui'

// Common chords for the "Play Chord" dropdown.
const STRUM_CHORDS = [
  'G', 'C', 'D', 'A', 'E', 'F', 'Am', 'Em', 'Dm', 'Bm',
  'G7', 'C7', 'D7', 'E7', 'A7', 'Cmaj7', 'Fmaj7', 'Am7', 'Em7', 'Dm7',
]

/**
 * StrummingStudio — its own top-level tab.
 *
 * A categorized library of strumming patterns with a live playhead. Playback is
 * PERCUSSIVE: each stroke fires a muted-string "chuck" (down = darker/fuller,
 * up = lighter/higher) rather than a pitched chord — exactly how you'd practise
 * a rhythm hand away from fretted notes.
 *
 * Legend per step: D = downstroke, U = upstroke, · = rest, ✕ = muted chuck (an
 * accented dead-string hit; also percussive, treated like a down stroke).
 */

// Every pattern is authored on the SAME 16th-note grid the Custom Studio uses,
// so 100 BPM plays identically in both. `sub: 2` (eighth-note) patterns are
// expanded to 16ths at load (see the normalize loop below); patterns given an
// exact 16th layout are marked `sub: 4`.
const LIBRARY = {
  Common: [
    // Exact user layout: D · D U · U D U
    { name: 'D DU UDU', seq: ['D', '', 'D', 'U', '', 'U', 'D', 'U'], sub: 4, feel: 'the "every song" strum' },
    // Exact user layout: D · · U · U D · · U · U D · D U
    { name: 'D UUD UUD DU', seq: ['D', '', '', 'U', '', 'U', 'D', '', '', 'U', '', 'U', 'D', '', 'D', 'U'], sub: 4, feel: 'rolling 16th groove' },
    // Exact user layout: D · U · D · · D · D U · D · · ·
    { name: 'DUD DDUD', seq: ['D', '', 'U', '', 'D', '', '', 'D', '', 'D', 'U', '', 'D', '', '', ''], sub: 4, feel: 'driving pop/rock' },
    { name: 'Down–Up 8ths', seq: ['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U'], sub: 2, feel: 'steady alternating driver' },
    // D · D U D · D U — the classic "D DU D DU", a different staple from D DU UDU.
    { name: 'D DU D DU', seq: ['D', '', 'D', 'U', 'D', '', 'D', 'U'], sub: 4, feel: 'steady pop/folk staple' },
  ],
  Uncommon: [
    // Bob Marley — "One Love" skank.
    { name: 'Reggae Skank', seq: ['D', 'U', 'X', 'U', 'X', 'U', 'X', 'U'], sub: 2, feel: 'off-beat, muted' },
    // Blues/rock muted backbeat.
    { name: 'Muted Backbeat', seq: ['D', 'U', 'X', 'U', 'D', 'U', 'X', 'U'], sub: 2, feel: 'driving, chucky' },
    // New Orleans second-line feel.
    { name: 'New Orleans', seq: ['D', 'D', 'U', '', 'U', 'D', '', 'U'], sub: 2, feel: 'funk / R&B groove' },
    { name: 'Bossa Feel', seq: ['D', '', '', 'U', '', 'D', 'U', ''], sub: 2, feel: 'latin lilt' },
    { name: 'Syncopated Push', seq: ['D', '', 'U', 'U', '', 'D', 'U', ''], sub: 2, feel: 'push-pull accents' },
  ],
  Easy: [
    { name: 'Four Downs', seq: ['D', '', 'D', '', 'D', '', 'D', ''], sub: 2, feel: 'quarter-note downs' },
    { name: 'Steady 8ths', seq: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D'], sub: 2, feel: 'straight eighths (ballad)' },
    { name: 'D · D U', seq: ['D', '', 'D', 'U', 'D', '', 'D', 'U'], sub: 2, feel: 'two-beat starter' },
    { name: 'Slow Ballad', seq: ['D', '', '', '', 'D', '', 'U', ''], sub: 2, feel: 'lots of space' },
  ],
  Difficult: [
    // Oasis — "Wonderwall" style 16ths.
    { name: 'Wonderwall 16ths', seq: ['D', 'D', 'D', 'D', 'U', 'D', 'U', 'D', 'D', 'D', 'D', 'U', '', '', '', ''], sub: 4, feel: 'busy 16th rock' },
    { name: '16th Funk', seq: ['D', 'U', 'X', 'U', 'D', 'U', 'X', 'U', 'D', 'U', 'X', 'U', 'D', 'U', 'X', 'U'], sub: 4, feel: 'ghost-note groove' },
    { name: 'Gallop Rock', seq: ['D', 'X', 'U', 'D', 'X', 'U', 'D', 'X', 'U', 'D', 'X', 'U', 'D', 'X', 'U', 'D'], sub: 4, feel: 'fast triplet feel' },
    { name: 'Flamenco Roll', seq: ['D', 'U', 'D', 'U', 'X', 'U', 'D', 'U', 'D', 'U', 'D', 'U', 'X', 'U', 'D', 'U'], sub: 4, feel: 'rasgueado-inspired' },
  ],
}

// One grid for everything: 4 steps per beat (16th notes). Eighth-note presets
// are expanded 1→2 cells so their rhythm is preserved but the timebase matches
// the Custom Studio exactly (this is the fix for "presets play slower than custom").
const SUB = 4
for (const cat of Object.values(LIBRARY)) {
  for (const p of cat) {
    if (p.sub === 2) p.seq = p.seq.flatMap((c) => [c, ''])
    p.sub = SUB
  }
}

const CATEGORIES = Object.keys(LIBRARY)
const CAT_COLOR = {
  Common: 'from-accent-400 to-accent-600',
  Uncommon: 'from-sky-400 to-indigo-500',
  Easy: 'from-mint-400 to-emerald-600',
  Difficult: 'from-rose-400 to-orange-500',
}

function Stroke({ s }) {
  if (s === 'D') return <span className="text-xl font-bold text-accent-400">↓</span>
  if (s === 'U') return <span className="text-xl font-bold text-mint-400">↑</span>
  if (s === 'X') return <span className="text-base font-black text-rose-300">✕</span>
  return <span className="text-white/20 text-xs">·</span>
}

/* ------------------------------------------------------------------ */
/* Custom Strumming Studio — a producer-style step sequencer.          */
/* Each pad cycles  Rest (—) → Down (↓) → Up (↑).  A playhead sweeps    */
/* left→right at the set BPM, firing muted chucks in exact tempo.       */
/* ------------------------------------------------------------------ */

// Cycle order for a pad tap:  Rest → Down → Up → Muted chuck → Rest.
const NEXT_STATE = { '-': 'D', D: 'U', U: 'X', X: '-' }

// Custom grid can be any length in this range (rows of 16 = one bar each).
const MIN_STEPS = 4
const MAX_STEPS = 64

function padVisual(v) {
  if (v === 'D') return { glyph: '↓', text: 'text-accent-300', ring: 'border-accent-400/60', fill: 'bg-accent-500/20' }
  if (v === 'U') return { glyph: '↑', text: 'text-mint-300', ring: 'border-mint-400/60', fill: 'bg-mint-500/15' }
  if (v === 'X') return { glyph: '✕', text: 'text-rose-300', ring: 'border-rose-400/60', fill: 'bg-rose-500/15' }
  return { glyph: '—', text: 'text-white/25', ring: 'border-white/10', fill: 'bg-white/[0.03]' }
}

/**
 * Human-feel articulation for the custom sequencer.
 *
 * A real guitarist doesn't execute every stroke identically. Emphasis, how many
 * strings the hand catches, note length and micro-timing all shift with the
 * surrounding rhythm — that variation is what makes a sequence groove instead of
 * sounding like a metronome. This is DETERMINISTIC: it's driven by the stroke's
 * metric position and its spacing to the neighbouring strokes, never by random
 * numbers. Same pattern → same performance, every time.
 *
 * Rules (matching how the hand actually moves):
 *  · A down after space (bar start / a rest) → full 6-string, strong, rings on.
 *  · A down crowded between strokes → squeezed: lower 3 strings, light, short —
 *    it "blends" between its neighbours (the 3rd D in "D DU UDU").
 *  · Upstrokes are always lighter and catch only the top strings.
 *  · Metric accent: beats > off-beats (&) > inner 16ths (e/a).
 *  · Off-beat 16ths sit a hair late (laid-back human feel).
 */
function humanize(steps, i, sub = 4) {
  const n = steps.length
  let prevIdx = -1
  for (let p = i - 1; p >= 0; p--) if (steps[p] !== '-') { prevIdx = p; break }
  let nextIdx = -1
  for (let q = i + 1; q < n; q++) if (steps[q] !== '-') { nextIdx = q; break }
  const prevGap = prevIdx === -1 ? 99 : i - prevIdx
  const nextGap = nextIdx === -1 ? 99 : nextIdx - i
  const prevStroke = prevIdx === -1 ? null : steps[prevIdx]
  const nextStroke = nextIdx === -1 ? null : steps[nextIdx]

  const inBeat = i % sub // 0=beat, 2=&, 1/3=inner 16ths
  const metric = inBeat === 0 ? 1.0 : inBeat === 2 ? 0.86 : 0.72
  // laid-back micro-timing on the off-beat subdivisions (seconds)
  const time = inBeat === 1 || inBeat === 3 ? 0.011 : inBeat === 2 ? 0.004 : 0

  const stroke = steps[i]
  // NB: no `sustain` override — the strings ring out naturally. "Brief" comes from
  // the fast sweep (small `spread`), not from a short note or choking.
  if (stroke === 'U') {
    const ghost = prevGap <= 1 // an up hard on the heels of another stroke
    return { kind: 'up', velocity: metric * (ghost ? 0.52 : 0.62), strings: 3, spread: 0.008, time }
  }
  if (stroke === 'X') {
    return { kind: 'x', velocity: metric * 0.85, strings: prevGap <= 1 ? 3 : 4, time }
  }
  // Downstroke articulation. Rhythm downs are voiced AS LIGHT AS the upstrokes
  // (matched velocity, top strings only) so they don't dominate. Strokes squeezed
  // between others get lighter and a touch faster still.
  const sandwiched = prevGap <= 1 && nextGap <= 1 && (prevStroke === 'U' || nextStroke === 'U')
  if (sandwiched) {
    return { kind: 'down', velocity: metric * 0.5, strings: 3, spread: 0.008, time }
  }
  return { kind: 'down', velocity: metric * 0.62, strings: 4, spread: 0.011, time }
}

// Dev-only handle so the humanization logic can be unit-checked from tests.
if (import.meta.env?.DEV && typeof window !== 'undefined') window.__humanize = humanize

function CustomSequencer({ mode, chord }) {
  const [count, setCount] = useState(8)
  const [steps, setSteps] = useState(() => Array(8).fill('-'))
  const [bpm, setBpm] = useState(100)
  const [playing, setPlaying] = useState(false)
  const [beat, setBeat] = useState(-1)
  const timer = useRef(null)

  // Sixteenth-note grid: every 4 pads = one beat (16 pads = a full bar). SUB is
  // the SAME grid the presets use, so BPM is identical across both players.
  const sub = SUB
  const stepMs = ((60 / bpm) / sub) * 1000
  // Rows of 16 (one bar each); longer patterns wrap onto more rows.
  const columns = Math.min(count, 16)
  const padText = columns >= 16 ? 'text-sm' : columns >= 12 ? 'text-lg' : 'text-2xl'

  const resize = (raw) => {
    const n = Math.max(MIN_STEPS, Math.min(MAX_STEPS, Number(raw) || MIN_STEPS))
    setPlaying(false)
    setCount(n)
    setSteps((prev) => {
      const next = Array(n).fill('-')
      for (let i = 0; i < Math.min(n, prev.length); i++) next[i] = prev[i]
      return next
    })
  }

  const toggle = (i) =>
    setSteps((prev) => {
      const next = [...prev]
      next[i] = NEXT_STATE[next[i]]
      return next
    })

  const clear = () => {
    setPlaying(false)
    setSteps(Array(count).fill('-'))
  }

  // Keep live refs so the running interval always reads the latest pattern and
  // sound settings (edit while it plays) without restarting the timer.
  const stepsRef = useRef(steps)
  useEffect(() => { stepsRef.current = steps }, [steps])
  const soundRef = useRef({ mode, chord })
  useEffect(() => { soundRef.current = { mode, chord } }, [mode, chord])

  // Playhead + audio. Each active step is performed with human-feel articulation
  // (see humanize): emphasis, string count, length and micro-timing adapt to the
  // surrounding rhythm instead of every stroke being an identical full sweep.
  useEffect(() => {
    if (!playing) {
      clearInterval(timer.current)
      setBeat(-1)
      return
    }
    let b = 0
    const fire = () => {
      const i = b % count
      setBeat(i)
      const v = stepsRef.current[i]
      if (v && v !== '-') {
        const a = humanize(stepsRef.current, i, sub)
        const { mode: m, chord: c } = soundRef.current
        if (m === 'chord') {
          if (a.kind === 'x') playStringMute({ velocity: a.velocity, time: a.time })
          else playAcousticStrum(c, { up: a.kind === 'up', velocity: a.velocity, strings: a.strings, sustain: a.sustain, spread: a.spread, time: a.time })
        } else {
          if (a.kind === 'x') playThumbSlap({ velocity: a.velocity, time: a.time })
          else playChuck({ up: a.kind === 'up', velocity: a.velocity, count: a.strings, time: a.time })
        }
      }
      b++
    }
    fire()
    timer.current = setInterval(fire, stepMs)
    return () => clearInterval(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stepMs, count])

  return (
    <div className="glass p-5 sm:p-6 relative overflow-hidden">
      {/* accent glow */}
      <div className="absolute -top-24 -right-16 h-56 w-56 rounded-full bg-accent-500/20 blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between mb-1 relative">
        <h2 className="font-bold text-lg flex items-center gap-2">
          <span className="text-accent-400">◆</span> Custom Strumming Studio
        </h2>
        <span className="chip text-white/50 text-xs">step sequencer</span>
      </div>
      <p className="text-xs text-white/40 mb-5">
        Tap a pad to cycle <span className="text-accent-400 font-semibold">↓ Down</span> →{' '}
        <span className="text-mint-400 font-semibold">↑ Up</span> →{' '}
        <span className="text-rose-300 font-semibold">✕ Chuck</span> →{' '}
        <span className="text-white/40 font-semibold">— Rest</span>. Strokes are performed with real
        human phrasing — emphasis &amp; feel adapt to the rhythm.
      </p>

      {/* Transport */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <button
          onClick={() => setPlaying((p) => !p)}
          className={playing ? 'btn-ghost' : 'btn-primary'}
        >
          {playing ? '❚❚ Stop' : '▶ Play'}
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40 tabular-nums w-16">{bpm} BPM</span>
          <input
            type="range"
            min="40"
            max="200"
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            style={rangeFill(bpm, 40, 200)}
            className="w-32"
          />
        </div>

        {/* Step-count stepper — dial in any length from 4 to 64. */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-white/40 mr-1">Steps</span>
          <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
            <button
              onClick={() => resize(count - 1)}
              disabled={count <= MIN_STEPS}
              className="w-7 h-7 grid place-items-center rounded-lg bg-white/5 hover:bg-white/15 font-mono disabled:opacity-30"
            >
              −
            </button>
            <input
              type="number"
              min={MIN_STEPS}
              max={MAX_STEPS}
              value={count}
              onChange={(e) => resize(parseInt(e.target.value, 10))}
              className="w-12 bg-transparent text-center font-mono font-bold tabular-nums outline-none"
            />
            <button
              onClick={() => resize(count + 1)}
              disabled={count >= MAX_STEPS}
              className="w-7 h-7 grid place-items-center rounded-lg bg-white/5 hover:bg-white/15 font-mono disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>

        <button onClick={clear} className="btn-ghost !py-1.5 ml-auto">
          Clear
        </button>
      </div>

      {/* Pad grid */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {steps.map((v, i) => {
          const vis = padVisual(v)
          const on = beat === i
          const beatMark = i % sub === 0
          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              className={`relative aspect-square rounded-xl border grid place-items-center select-none transition-transform ${
                vis.fill
              } ${on ? 'border-white/70 scale-105' : vis.ring} ${beatMark ? 'ring-1 ring-white/10' : ''}`}
              style={
                on
                  ? { boxShadow: '0 0 22px -2px rgba(139,92,246,0.8)', background: 'rgba(139,92,246,0.4)' }
                  : undefined
              }
            >
              <span className={`${padText} font-black ${on ? 'text-white' : vis.text}`}>{vis.glyph}</span>
              {beatMark && (
                <span className="absolute top-1 left-1.5 text-[9px] text-white/30 font-mono">
                  {i / sub + 1}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p className="mt-6 font-mono text-center text-sm tracking-widest text-white/40">
        {steps.map((s) => (s === '-' ? '·' : s)).join(' ')}
      </p>
    </div>
  )
}

export default function StrummingStudio() {
  const [cat, setCat] = useState('Common')
  const [sel, setSel] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [beat, setBeat] = useState(-1)
  const [tempo, setTempo] = useState(96)
  const [mode, setMode] = useState('chuck') // 'chuck' | 'chord'
  const [chord, setChord] = useState('G')
  const timer = useRef(null)

  // One stroke → the right sound for the current mode. Shared by both players.
  const strike = useRef(null)
  strike.current = (stroke) => {
    if (mode === 'chord') {
      // Rhythm strums: top strings only, matched light velocity, and a fast crisp
      // sweep — but they RING OUT naturally (no choking). The full heavy sweep is
      // reserved for the Capo Optimizer's single-chord auditions.
      if (stroke === 'D') playAcousticStrum(chord, { up: false, strings: 4, velocity: 0.7 })
      else if (stroke === 'U') playAcousticStrum(chord, { up: true, strings: 3, velocity: 0.7 })
      else if (stroke === 'X') playStringMute()
    } else {
      if (stroke === 'D') playChuck({ up: false, velocity: 0.95 })
      else if (stroke === 'U') playChuck({ up: true, velocity: 0.8 })
      else if (stroke === 'X') playThumbSlap()
    }
  }
  const doStrike = (s) => strike.current(s)

  const patterns = LIBRARY[cat]
  const pattern = patterns[sel]
  // Same 16th-note timebase as the Custom Studio → identical speed at equal BPM.
  const stepMs = ((60 / tempo) / SUB) * 1000
  const presetCols = Math.min(pattern.seq.length, 16)

  // Reset selection when switching category.
  const chooseCat = (c) => {
    setCat(c)
    setSel(0)
    setPlaying(false)
  }

  useEffect(() => {
    if (!playing) {
      clearInterval(timer.current)
      setBeat(-1)
      return
    }
    let b = 0
    const fire = () => {
      const step = b % pattern.seq.length
      setBeat(step)
      const s = pattern.seq[step]
      if (s === 'D' || s === 'U' || s === 'X') doStrike(s)
      b++
    }
    fire()
    timer.current = setInterval(fire, stepMs)
    return () => clearInterval(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, cat, sel, stepMs])

  return (
    <div className="space-y-6">
      <div className="glass p-5 sm:p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold text-lg">Strumming Studio</h2>
          <span className="chip text-white/50 text-xs">
            {mode === 'chord' ? 'ringing chords · real strums' : 'percussive practice · muted chucks'}
          </span>
        </div>
        <p className="text-xs text-white/40 mb-5">
          {mode === 'chord'
            ? 'Pick a pattern and a chord, hit play, and hear the full strum in time.'
            : 'Pick a pattern, hit play, and lock the groove into your strumming hand.'}
        </p>

        {/* Sound mode: muted chucks vs a real ringing chord */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
            {[
              ['chuck', '✕ Muted Chucks'],
              ['chord', '🎸 Play Chord'],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  mode === id ? 'bg-accent-500/80 text-white' : 'text-white/50 hover:text-white/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {mode === 'chord' ? (
              <motion.label
                key="chord-pick"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <span className="text-xs text-white/40">Chord</span>
                <select
                  value={chord}
                  onChange={(e) => setChord(e.target.value)}
                  className="bg-black/40 border border-white/10 focus:border-accent-400/50 rounded-xl px-3 py-1.5 text-sm font-mono outline-none"
                >
                  {STRUM_CHORDS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-white/40 hidden sm:inline">
                  ↓ down · ↑ up (lighter) · ✕ string-mute
                </span>
              </motion.label>
            ) : (
              <motion.span
                key="chuck-hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[11px] text-white/40"
              >
                ↓ full rake · ↑ lighter/brighter · ✕ thumb slap
              </motion.span>
            )}
          </AnimatePresence>

          {/* quick audition buttons */}
          <div className="flex items-center gap-1 ml-auto">
            {['D', 'U', 'X'].map((s) => (
              <button
                key={s}
                onClick={() => doStrike(s)}
                className="w-8 h-8 grid place-items-center rounded-lg bg-white/5 hover:bg-white/15 text-sm font-bold"
                title={`Audition ${s}`}
              >
                {s === 'D' ? '↓' : s === 'U' ? '↑' : '✕'}
              </button>
            ))}
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => chooseCat(c)}
              className={`relative px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                cat === c ? 'text-white' : 'text-white/50 hover:text-white/80'
              }`}
            >
              {cat === c && (
                <motion.span
                  layoutId="studio-cat"
                  className={`absolute inset-0 -z-10 rounded-full bg-gradient-to-r ${CAT_COLOR[c]} shadow-glow`}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              {c}
            </button>
          ))}
        </div>

        {/* Pattern grid for this category */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {patterns.map((p, i) => (
            <button
              key={p.name}
              onClick={() => {
                setSel(i)
                setPlaying(false)
              }}
              className={`text-left rounded-xl px-3 py-2.5 border transition-colors ${
                sel === i
                  ? 'border-accent-400/50 bg-accent-500/15'
                  : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <div className="font-semibold text-sm">{p.name}</div>
              <div className="text-[11px] text-white/40">{p.feel}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Player */}
      <div className="glass-soft p-5 sm:p-6">
        <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
          <div>
            <p className="font-semibold text-lg">{pattern.name}</p>
            <p className="text-xs text-white/40">
              {cat} · {pattern.feel} · {pattern.seq.length} steps
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">{tempo} BPM</span>
              <input
                type="range"
                min="50"
                max="160"
                value={tempo}
                onChange={(e) => setTempo(Number(e.target.value))}
                style={rangeFill(tempo, 50, 160)}
                className="w-28"
              />
            </div>
            <button
              onClick={() => setPlaying((p) => !p)}
              className={playing ? 'btn-ghost' : 'btn-primary'}
            >
              {playing ? '❚❚ Stop' : '▶ Play'}
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={cat + sel}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${presetCols}, minmax(0, 1fr))` }}
          >
            {pattern.seq.map((s, i) => {
              const activeStep = beat === i
              const beatMark = i % SUB === 0
              return (
                <motion.div
                  key={i}
                  animate={{
                    scale: activeStep ? 1.14 : 1,
                    backgroundColor: activeStep ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.04)',
                  }}
                  className={`aspect-square rounded-xl border flex items-center justify-center relative ${
                    beatMark ? 'border-white/20' : 'border-white/5'
                  }`}
                >
                  <Stroke s={s} />
                  {beatMark && (
                    <span className="absolute -bottom-4 text-[9px] text-white/30 font-mono">
                      {i / SUB + 1}
                    </span>
                  )}
                </motion.div>
              )
            })}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 font-mono text-center text-sm tracking-widest text-white/50">
          {pattern.seq.map((s) => s || '·').join(' ')}
        </div>
      </div>

      {/* Build-your-own step sequencer */}
      <CustomSequencer mode={mode} chord={chord} />
    </div>
  )
}
