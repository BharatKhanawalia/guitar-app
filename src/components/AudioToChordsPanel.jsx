import { useState, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ErrorBoundary from './ErrorBoundary'

// The DSP + ML + worker bundle stays out of the initial load; it only loads
// when the visitor explicitly opts into the preview.
const AudioToChords = lazy(() => import('./audio2chords/AudioToChords'))

const EQ_HEIGHTS = [40, 70, 55, 90, 65, 100, 50, 80, 45]

/**
 * Audio → Chords tab — the Fretwork "We're polishing the AI" card (animated
 * equalizer, shimmering top border, COMING SOON badge). The still-in-progress
 * feature is hidden from production, but "Preview the full experience" reveals
 * the real AudioToChords module on demand.
 */
export default function AudioToChordsPanel() {
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <AnimatePresence mode="wait" initial={false}>
        {!previewOpen ? (
          /* ---- Intro card ---- */
          <motion.div
            key="card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="relative text-center overflow-hidden"
            style={{
              borderRadius: 24, background: 'var(--gt-panel)', border: '1px solid var(--gt-border)',
              padding: 'clamp(36px,5vw,56px) clamp(20px,4vw,32px)', boxShadow: '0 3px 12px rgba(0,0,0,.4)',
            }}
          >
            {/* Shimmering top border, sweeping like a loading bar. */}
            <div
              className="absolute top-0 left-0 right-0"
              style={{
                height: 3,
                background: 'linear-gradient(90deg, transparent, var(--gt-accent), var(--gt-mint), transparent)',
                backgroundSize: '200% 100%',
                animation: 'gt-shimmer 3s linear infinite',
              }}
            />

            {/* Animated equalizer */}
            <div className="flex items-end justify-center" style={{ gap: 4, height: 56, marginBottom: 24 }}>
              {EQ_HEIGHTS.map((h, i) => (
                <span
                  key={i}
                  className="gt-eq-bar"
                  style={{ height: `${h}%`, animationDuration: `${0.7 + (i % 4) * 0.18}s`, animationDelay: `${i * 0.08}s` }}
                />
              ))}
            </div>

            <span
              className="font-mono"
              style={{ fontSize: 10, padding: '5px 12px', borderRadius: 20, background: 'color-mix(in srgb, var(--gt-amber) 16%, transparent)', color: 'var(--gt-amber)', letterSpacing: '.1em', fontWeight: 600 }}
            >
              COMING SOON
            </span>
            <h2 className="font-display" style={{ margin: '16px 0 0', fontSize: 'clamp(24px,4vw,30px)', fontWeight: 700, letterSpacing: '-.02em', color: 'var(--gt-text)' }}>
              We&rsquo;re polishing the AI
            </h2>
            <p style={{ margin: '12px auto 0', maxWidth: 460, fontSize: 14, color: 'var(--gt-muted)', lineHeight: 1.6 }}>
              Drop in any song and get chords, a beat grid, key and BPM — detected entirely on your device. Choose a fast
              DSP engine or an AI pipeline that separates vocals and transcribes lyrics. No uploads, ever.
            </p>

            <button
              onClick={() => setPreviewOpen(true)}
              className="gt-btn gt-btn-primary"
              style={{ marginTop: 26, height: 46, padding: '0 22px', fontSize: 14 }}
            >
              Preview the full experience →
            </button>
          </motion.div>
        ) : (
          /* ---- Live feature ---- */
          <motion.div
            key="feature"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <div className="flex justify-center mb-5">
              <button
                onClick={() => setPreviewOpen(false)}
                className="gt-btn gt-btn-ghost"
                style={{ height: 40, padding: '0 18px', fontSize: 13 }}
              >
                ← Hide preview
              </button>
            </div>
            <ErrorBoundary label="Audio → Chords">
              <Suspense fallback={<div className="glass p-10 text-center text-white/50">Loading Audio → Chords…</div>}>
                <AudioToChords />
              </Suspense>
            </ErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
