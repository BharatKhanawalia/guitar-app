import { useState, useEffect, lazy, Suspense } from 'react'
import ErrorBoundary from './ErrorBoundary'

// The heavy MediaPipe hand-tracking bundle loads only once the studio opens.
const ARStudio = lazy(() => import('./ARStudio'))

/**
 * Magic Chords tab — the Fretwork "Play music in the air" showcase card. It
 * stays a dark, immersive panel in both themes (matching the design). "Enter
 * studio" reveals the actual AR hand-tracking studio; "How it works" toggles a
 * short primer.
 */
export default function MagicChordsPanel({ onImmersiveChange }) {
  const [studioOpen, setStudioOpen] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  // Tell the app to drop its chrome while the full-screen studio is open (and
  // always restore it when this panel unmounts, e.g. on tab switch).
  useEffect(() => {
    onImmersiveChange?.(studioOpen)
    return () => onImmersiveChange?.(false)
  }, [studioOpen, onImmersiveChange])

  if (studioOpen) {
    return (
      <ErrorBoundary label="AR Studio">
        <Suspense
          fallback={<div className="glass p-10 text-center text-white/50 max-w-4xl mx-auto">Loading AR Studio…</div>}
        >
          {/* autoEnter skips ARStudio's own launch card (this panel IS the launch
              card); exiting the studio returns here. */}
          <ARStudio autoEnter onExit={() => setStudioOpen(false)} />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', animation: 'gt-fadeup 0.4s ease both' }}>
      <div
        className="relative overflow-hidden"
        style={{
          borderRadius: 24,
          background:
            'radial-gradient(120% 140% at 20% 0%, oklch(0.4 0.18 292 / .55), transparent 55%), radial-gradient(100% 120% at 90% 100%, oklch(0.5 0.16 200 / .4), transparent 50%), #0a0a10',
          border: '1px solid var(--gt-border)',
          padding: 'clamp(32px,5vw,52px) clamp(24px,4vw,44px)',
          color: '#f3f3f6',
          boxShadow: '0 12px 34px rgba(0,0,0,.5)',
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.5,
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,.14) 1px, transparent 0)',
            backgroundSize: '26px 26px',
          }}
        />
        <div className="relative" style={{ maxWidth: 520 }}>
          <span
            className="inline-flex items-center font-mono"
            style={{
              gap: 6, fontSize: 10, padding: '5px 11px', borderRadius: 20,
              background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
              letterSpacing: '.1em', marginBottom: 20,
            }}
          >
            ✦ FLAGSHIP · WEBCAM INSTRUMENT
          </span>
          <h2 className="font-display" style={{ margin: 0, fontSize: 'clamp(30px,5vw,40px)', fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1.05 }}>
            Play music in the air
          </h2>
          <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.6, color: 'rgba(255,255,255,.75)' }}>
            Use your webcam and your hands to conjure chords and melodies — no strings attached. Two radial menus, 14
            instruments, sustained pads that glide between chords. It opens full-screen and immersive.
          </p>

          <div className="flex flex-wrap" style={{ gap: 12, marginTop: 28 }}>
            <button
              onClick={() => setStudioOpen(true)}
              className="gt-btn gt-btn-primary"
              style={{ height: 50, padding: '0 26px', fontSize: 15 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              Enter studio
            </button>
            <button
              onClick={() => setShowHelp((v) => !v)}
              className="gt-btn gt-btn-ghost-onDark"
              style={{ height: 50, padding: '0 22px', fontSize: 14 }}
            >
              How it works
            </button>
          </div>

          {showHelp && (
            <ol
              style={{ margin: '22px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.9, color: 'rgba(255,255,255,.8)', animation: 'gt-fadeup 0.3s ease both' }}
            >
              <li>Allow camera access — everything runs on-device, nothing is uploaded.</li>
              <li>Raise a hand: the left radial picks the chord, the right picks the instrument.</li>
              <li>Pinch to strum; move between zones and the pad glides smoothly between chords.</li>
            </ol>
          )}

          <div className="flex flex-wrap" style={{ gap: 22, marginTop: 32 }}>
            <div className="flex items-center" style={{ gap: 8, fontSize: 12, color: 'rgba(255,255,255,.7)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gt-mint)' }} />
              Lightweight — won&rsquo;t cook your laptop
            </div>
            <div className="flex items-center" style={{ gap: 8, fontSize: 12, color: 'rgba(255,255,255,.7)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gt-mint)' }} />
              Camera stays on your device
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
