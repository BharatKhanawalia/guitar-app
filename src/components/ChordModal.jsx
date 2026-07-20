import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import FretboardDiagram from './FretboardDiagram'
import { playChordShifted } from '../lib/audioEngine'

/**
 * ChordModal — the click-to-open detail dialog for a capo position.
 * Replaces the old frustrating hover-to-peek behaviour. Shows the fret, the
 * full transposed set, large SVG chord shapes and a per-chord "tap to play".
 *
 * Renders through a portal over a blurred glassmorphism backdrop.
 */
export default function ChordModal({ result, onClose }) {
  const open = !!result

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {/* Glassmorphism backdrop */}
          <div className="absolute inset-0 bg-ink-900/60 backdrop-blur-xl" />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Capo ${result.capo} chord shapes`}
            initial={{ opacity: 0, y: 30, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto glass p-6 sm:p-8"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl grid place-items-center bg-gradient-to-br from-accent-400 to-accent-600 shadow-glow shrink-0">
                  <div className="text-center leading-none">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-white/70">
                      Capo
                    </div>
                    <div className="text-2xl font-black">{result.capo}</div>
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-extrabold">
                    {result.capo === 0 ? 'Open — no capo' : `Capo on fret ${result.capo}`}
                  </h3>
                  <p className="text-sm text-white/50 mt-0.5">
                    <span className="text-mint-400 font-semibold">{result.openCount} open</span>
                    {' · '}
                    <span className="text-rose-300 font-semibold">{result.barreCount} barre</span>
                    {' · '}
                    {result.total} chords
                    {result.recommended && (
                      <span className="ml-2 chip !py-0.5 text-mint-400 border-mint-400/40 bg-mint-400/10">
                        ★ Recommended
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="btn-ghost !p-2 !rounded-full shrink-0 text-lg leading-none w-9 h-9"
              >
                ✕
              </button>
            </div>

            {/* Play-all bar */}
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <p className="text-xs uppercase tracking-widest text-white/40">
                Shapes you actually finger with this capo
              </p>
              <button
                onClick={() =>
                  result.chords.forEach((c, i) =>
                    // Play the CAPO'd sound: this shape's voicing moved up by the
                    // capo fret — what you'd actually hear on the guitar.
                    setTimeout(() => playChordShifted(c, result.capo), i * 320),
                  )
                }
                className="btn-primary !py-1.5 text-sm"
              >
                ▶ Play progression
              </button>
            </div>

            {/* Chord diagram grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {result.chords.map((chord, i) => (
                <motion.button
                  key={`${chord}-${i}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => playChordShifted(chord, result.capo)}
                  className="group glass-soft p-3 flex flex-col items-center hover:bg-accent-500/10 hover:border-accent-400/40 transition-colors active:scale-95"
                >
                  <span className="font-mono font-bold text-accent-400 mb-1">{chord}</span>
                  <FretboardDiagram symbol={chord} size="md" />
                  <span className="mt-2 text-[11px] text-white/40 group-hover:text-mint-400 transition-colors">
                    ▶ Tap to play
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
