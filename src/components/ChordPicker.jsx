import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import FretboardDiagram from './FretboardDiagram'
import { playChord } from '../lib/audioEngine'
import { chordDifficulty, respell, respellChord } from '../lib/chordTheory'

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const QUALITIES = [
  { label: 'maj', suffix: '' },
  { label: 'min', suffix: 'm' },
  { label: '7', suffix: '7' },
  { label: 'm7', suffix: 'm7' },
  { label: 'maj7', suffix: 'maj7' },
  { label: 'sus4', suffix: 'sus4' },
]

const TAG_STYLE = {
  open: 'text-mint-400 border-mint-400/40 bg-mint-400/10',
  easy: 'text-sky-300 border-sky-300/40 bg-sky-300/10',
  medium: 'text-amber-300 border-amber-300/40 bg-amber-300/10',
  barre: 'text-rose-300 border-rose-300/40 bg-rose-300/10',
  other: 'text-white/60 border-white/20 bg-white/5',
}

export default function ChordPicker({ selected, onChange, preferFlats = false }) {
  const [root, setRoot] = useState('C') // canonical (sharp) root
  const [preview, setPreview] = useState('C') // canonical preview symbol

  const spell = (sym) => respellChord(sym, preferFlats)

  const addChord = (canonical) => {
    const chord = spell(canonical)
    if (!selected.includes(chord)) onChange([...selected, chord])
    playChord(chord)
  }

  const removeChord = (chord) => onChange(selected.filter((c) => c !== chord))

  return (
    <div className="space-y-5">
      {/* Root selector */}
      <div>
        <p className="text-xs uppercase tracking-widest text-white/40 mb-2">Root</p>
        <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5">
          {ROOTS.map((r) => (
            <button
              key={r}
              onClick={() => {
                setRoot(r)
                setPreview(r)
              }}
              className={`h-10 rounded-xl font-mono text-sm font-semibold transition-all ${
                root === r
                  ? 'bg-accent-500 text-white shadow-glow'
                  : 'bg-white/5 hover:bg-white/10 text-white/80'
              }`}
            >
              {respell(r, preferFlats)}
            </button>
          ))}
        </div>
      </div>

      {/* Quality + live preview */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-widest text-white/40 mb-2">Quality</p>
          <div className="grid grid-cols-3 gap-1.5">
            {QUALITIES.map((q) => {
              const canonical = root + q.suffix
              return (
                <button
                  key={q.label}
                  onMouseEnter={() => setPreview(canonical)}
                  onFocus={() => setPreview(canonical)}
                  onClick={() => {
                    setPreview(canonical)
                    addChord(canonical)
                  }}
                  className="group relative h-11 rounded-xl bg-white/5 hover:bg-accent-500/20 border border-white/10 hover:border-accent-400/50 font-mono text-sm transition-all"
                >
                  <span className="text-white/90">{spell(canonical)}</span>
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-white/40 mt-2">
            Tap a quality to add it to your progression — the shape previews live on the right.
          </p>
        </div>

        {/* Live SVG preview */}
        <div className="glass-soft flex flex-col items-center justify-center px-4 py-3 min-w-[140px]">
          <FretboardDiagram symbol={spell(preview)} size="md" />
          <span className="font-mono text-sm font-bold mt-1">{spell(preview)}</span>
        </div>
      </div>

      {/* Selected chord chips */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-widest text-white/40">
            Your progression · {selected.length}
          </p>
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold
                         text-rose-200 bg-rose-500/15 border border-rose-400/40
                         hover:bg-rose-500/30 hover:border-rose-400/70 active:scale-95 transition-all"
              title="Remove every chord from your progression"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
              Clear all
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 min-h-[44px]">
          <AnimatePresence mode="popLayout">
            {selected.map((chord) => {
              const display = spell(chord)
              const tag = chordDifficulty(chord).tag
              return (
                <motion.button
                  layout
                  key={chord}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  onClick={() => removeChord(chord)}
                  className={`chip font-mono ${TAG_STYLE[tag]} hover:brightness-125`}
                  title={`${tag} chord — click to remove`}
                >
                  {display}
                  <span className="opacity-50 text-xs">✕</span>
                </motion.button>
              )
            })}
          </AnimatePresence>
          {selected.length === 0 && (
            <span className="text-white/30 text-sm self-center">
              No chords yet — build your progression above.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
