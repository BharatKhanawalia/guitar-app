import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { optimizeCapo } from '../lib/chordTheory'
import { playChordShifted } from '../lib/audioEngine'
import ChordModal from './ChordModal'

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}
const card = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 260, damping: 22 } },
}

/** A tappable chord pill. Stops propagation so it doesn't also open the modal.
 *  With a `capo` fret > 0 it plays the chord PITCH-SHIFTED up that many semitones —
 *  i.e. exactly what the shape sounds like with a capo on that fret (so an A shape
 *  at capo 3 sounds like C, not open A). Capo-0 / original shapes play as written. */
function ChordTag({ chord, capo = 0 }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        playChordShifted(chord, capo) // capo>0 → shape's voicing moved up = real capo sound
      }}
      className="font-mono text-sm px-2 py-1 rounded-lg bg-white/5 hover:bg-accent-500/30 transition-colors active:scale-90"
    >
      {chord}
    </button>
  )
}

/** Small reusable open/barre counter row shared by the summary cards. */
function Counters({ openCount, barreCount }) {
  return (
    <div className="flex gap-1 text-[10px] font-medium">
      {openCount > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-mint-400/15 text-mint-400">{openCount} open</span>
      )}
      {barreCount > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-rose-400/15 text-rose-300">
          {barreCount} barre
        </span>
      )}
    </div>
  )
}

export default function CapoOptimizer({ chords, preferFlats }) {
  const results = useMemo(() => optimizeCapo(chords, 11, preferFlats), [chords, preferFlats])
  const [modal, setModal] = useState(null)

  const best = results.find((r) => r.recommended)
  const original = results.find((r) => r.capo === 0)
  const maxScore = Math.max(...results.map((r) => r.score), 1)
  const minScore = Math.min(...results.map((r) => r.score), 0)

  if (chords.length === 0) {
    return (
      <div className="glass p-10 text-center text-white/40">
        Add a few chords to see every capo position ranked for playability.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Original chords (capo 0) — the shapes as written, before any capo. */}
      {original && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setModal(original)}
          className="glass p-5 cursor-pointer hover:border-white/20 transition-colors"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="chip text-white/70">Original Chords (Capo 0)</span>
            <div>
              <p className="text-sm text-white/50">As written · tap a chord to hear it</p>
              <Counters openCount={original.openCount} barreCount={original.barreCount} />
            </div>
            <div className="font-mono text-white/90 flex flex-wrap gap-1.5 sm:ml-auto">
              {original.chords.map((c, i) => (
                <ChordTag key={`orig-${c}-${i}`} chord={c} capo={0} />
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Recommendation banner */}
      <AnimatePresence>
        {best && (
          <motion.div
            key={best.capo}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setModal(best)}
            className="glass p-5 relative overflow-hidden cursor-pointer"
          >
            <motion.div
              className="absolute inset-0 -z-10"
              animate={{ opacity: [0.4, 0.75, 0.4] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                background: 'radial-gradient(80% 120% at 0% 0%, rgba(16,185,129,0.22), transparent 60%)',
              }}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="chip text-mint-400 border-mint-400/40 bg-mint-400/10 shadow-glow-mint">
                ★ Recommended
              </span>
              <div>
                <p className="text-lg font-bold">
                  {best.capo === 0 ? 'No capo needed' : `Capo on fret ${best.capo}`}
                </p>
                <p className="text-sm text-white/50">
                  {best.openCount} open shapes · {best.barreCount} barre chords
                </p>
              </div>
              <div className="font-mono text-white/90 flex flex-wrap gap-1.5 sm:ml-auto">
                {best.chords.map((c, i) => (
                  <ChordTag key={`${c}-${i}`} chord={c} capo={best.capo} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend for the meter */}
      <div className="flex items-center gap-2 text-[11px] text-white/40 px-1">
        <span className="inline-block w-8 h-1.5 rounded-full bg-gradient-to-r from-accent-500 to-accent-400" />
        Green/violet bar = Playability / Easiness Score · tap any card for chord shapes
      </div>

      {/* Full comparison grid — every box is clickable → detail modal */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
      >
        {results.map((r) => {
          const t = (r.score - minScore) / (maxScore - minScore || 1)
          return (
            <motion.div
              layout
              variants={card}
              key={r.capo}
              onClick={() => setModal(r)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setModal(r)}
              className={`relative rounded-2xl p-4 border cursor-pointer transition-colors ${
                r.recommended
                  ? 'border-mint-400/50 bg-mint-400/[0.07] shadow-glow-mint'
                  : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
              }`}
            >
              {r.recommended && (
                <motion.span
                  layoutId="reco-badge"
                  className="absolute -top-2 -right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-mint-500 text-ink-900 shadow-glow-mint"
                >
                  BEST
                </motion.span>
              )}
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm">{r.capo === 0 ? 'Open' : `Capo ${r.capo}`}</span>
                <Counters openCount={r.openCount} barreCount={r.barreCount} />
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {r.chords.map((c, i) => (
                  <ChordTag key={`${r.capo}-${c}-${i}`} chord={c} capo={r.capo} />
                ))}
              </div>

              {/* Easiness / playability meter */}
              <div
                className="h-1.5 rounded-full bg-white/10 overflow-hidden"
                title="Playability / Easiness Score"
              >
                <motion.div
                  className="h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(6, t * 100)}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                  style={{
                    background: r.recommended
                      ? 'linear-gradient(90deg,#34d399,#10b981)'
                      : 'linear-gradient(90deg,#8b5cf6,#a78bfa)',
                  }}
                />
              </div>
            </motion.div>
          )
        })}
      </motion.div>

      <ChordModal result={modal} onClose={() => setModal(null)} />
    </div>
  )
}
