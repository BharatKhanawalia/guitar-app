import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { playChuck } from '../lib/audioEngine'

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

// sub = stepsPerBeat: 2 = eighth-note grid, 4 = sixteenth-note grid.
const LIBRARY = {
  Common: [
    // The single most-used acoustic strum (Horse With No Name, Riptide, …).
    { name: 'D DU UDU', seq: ['D', '', 'D', 'U', '', 'U', 'D', 'U'], sub: 2, feel: 'the "every song" strum' },
    // Requested — spells D UU D UU D DU across the bar.
    { name: 'D UUD UUD DU', seq: ['D', '', 'U', 'U', 'D', '', 'U', 'U', 'D', '', 'D', 'U', '', '', '', ''], sub: 4, feel: 'rolling 16th groove' },
    // Requested — D U D · D D U D.
    { name: 'DUD DDUD', seq: ['D', 'U', 'D', '', 'D', 'D', 'U', 'D'], sub: 2, feel: 'driving pop/rock' },
    { name: 'Down–Up 8ths', seq: ['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U'], sub: 2, feel: 'steady alternating driver' },
    { name: 'Folk / Ballad', seq: ['D', 'D', 'U', '', 'U', 'D', 'U', ''], sub: 2, feel: 'gentle, flowing' },
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

// Cycle order for a pad tap.
const NEXT_STATE = { '-': 'D', D: 'U', U: '-' }

// Available grid lengths. 16+ wrap onto two rows.
const SEQ_SIZES = [4, 8, 12, 16, 24, 32]

function padVisual(v) {
  if (v === 'D') return { glyph: '↓', text: 'text-accent-300', ring: 'border-accent-400/60', fill: 'bg-accent-500/20' }
  if (v === 'U') return { glyph: '↑', text: 'text-mint-300', ring: 'border-mint-400/60', fill: 'bg-mint-500/15' }
  return { glyph: '—', text: 'text-white/25', ring: 'border-white/10', fill: 'bg-white/[0.03]' }
}

function CustomSequencer() {
  const [count, setCount] = useState(8)
  const [steps, setSteps] = useState(() => Array(8).fill('-'))
  const [bpm, setBpm] = useState(100)
  const [playing, setPlaying] = useState(false)
  const [beat, setBeat] = useState(-1)
  const timer = useRef(null)

  // Sixteenth-note grid: every 4 pads = one beat (16 pads = a full bar).
  const sub = 4
  const stepMs = ((60 / bpm) / sub) * 1000
  // Up to 16 pads per row; longer patterns wrap onto a second row.
  const columns = count <= 16 ? count : Math.ceil(count / 2)
  const padText = columns >= 16 ? 'text-sm' : columns >= 12 ? 'text-lg' : 'text-2xl'

  const resize = (n) => {
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

  // Keep a live ref of steps so the running interval always reads the latest
  // pattern (edit pads while it plays) without restarting the timer.
  const stepsRef = useRef(steps)
  useEffect(() => {
    stepsRef.current = steps
  }, [steps])

  // Playhead + audio. Re-seeds whenever tempo/pattern length changes.
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
      if (v === 'D') playChuck({ up: false, velocity: 0.95 })
      else if (v === 'U') playChuck({ up: true, velocity: 0.8 })
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
        Tap a pad to cycle <span className="text-accent-300 font-semibold">↓ Down</span> →{' '}
        <span className="text-mint-300 font-semibold">↑ Up</span> →{' '}
        <span className="text-white/40 font-semibold">— Rest</span>. Hit play and build your own groove.
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
            className="w-32"
          />
        </div>

        {/* Step-count selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-white/40 mr-1">Steps</span>
          <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
            {SEQ_SIZES.map((n) => (
              <button
                key={n}
                onClick={() => resize(n)}
                className={`px-2.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  count === n ? 'bg-accent-500/80 text-white' : 'text-white/50 hover:text-white/80'
                }`}
              >
                {n}
              </button>
            ))}
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
  const timer = useRef(null)

  const patterns = LIBRARY[cat]
  const pattern = patterns[sel]
  const stepMs = ((60 / tempo) / pattern.sub) * 1000

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
      if (s === 'D' || s === 'X') playChuck({ up: false, velocity: s === 'X' ? 0.7 : 0.95 })
      else if (s === 'U') playChuck({ up: true, velocity: 0.8 })
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
          <span className="chip text-white/50 text-xs">percussive practice · muted chucks</span>
        </div>
        <p className="text-xs text-white/40 mb-5">
          Pick a pattern, hit play, and lock the groove into your strumming hand. Down (↓) and
          up (↑) strokes trigger distinct muted string sounds — ✕ is an accented dead-string chuck.
        </p>

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
              {cat} · {pattern.feel} · {pattern.sub === 4 ? 'sixteenth' : 'eighth'}-note grid
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
            className="grid gap-1.5 grid-cols-8"
          >
            {pattern.seq.map((s, i) => {
              const activeStep = beat === i
              const beatMark = i % pattern.sub === 0
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
                      {i / pattern.sub + 1}
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
      <CustomSequencer />
    </div>
  )
}
