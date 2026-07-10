import { useRef, useState, useEffect, useCallback, memo } from 'react'
import { motion } from 'framer-motion'
import Webcam from 'react-webcam'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { startChord, releaseChord } from '../lib/audioEngine'

/**
 * ARStudio — play chords by waving your hands in the air.
 *
 * A mirrored webcam feed with two futuristic radial HUD menus overlaid:
 *   • Left  ring  → root notes    (C D E F G A B)
 *   • Right ring  → chord quality  (maj m 7 maj7 dim aug)
 *
 * We track the index-finger tip (MediaPipe landmark 8) of each hand. Whichever
 * fingertip is inside a ring selects that ring's segment. Once a root + quality
 * are held together for a short lock (~130 ms) the chord SUSTAINS — it keeps
 * ringing for as long as your finger stays on it, and releases the moment you
 * pull away or move to a different chord.
 *
 * PERFORMANCE: the two labelled menus are static SVG that only re-render when the
 * highlighted segment changes (a few times/sec). Everything that moves every
 * frame — the fingertip cursors, the lock ring and the centre chord — is painted
 * imperatively on a <canvas>, so the detection loop never triggers React work.
 */

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const QUALITIES = [
  { label: 'maj', suffix: '' },
  { label: 'm', suffix: 'm' },
  { label: '7', suffix: '7' },
  { label: 'maj7', suffix: 'maj7' },
  { label: 'dim', suffix: 'dim' },
  { label: 'aug', suffix: 'aug' },
]
const ROOT_SEGMENTS = ROOTS.map((r) => ({ key: r, text: r }))
const QUALITY_SEGMENTS = QUALITIES.map((q) => ({ key: q.label, text: q.label }))
const L_TINT = { on: 'rgba(139,92,246,0.55)', off: 'rgba(139,92,246,0.12)', stroke: '#a78bfa' }
const R_TINT = { on: 'rgba(56,189,248,0.55)', off: 'rgba(56,189,248,0.12)', stroke: '#38bdf8' }

// Overlay coordinate space (4:3).
const VBW = 1000
const VBH = 750
const L = { cx: 250, cy: 375, r: 205 }
const R = { cx: 750, cy: 375, r: 205 }
const INNER = 0.34 // fraction of r that reads as the neutral "hole"
const LOCK_MS = 130 // hold this long on a new chord before it sounds
const RELEASE_MS = 90 // grace period before a lost chord is released (debounces detection gaps)
const PINCH = 0.055

const INDEX_TIP = 8
const THUMB_TIP = 4

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                   */
/* ------------------------------------------------------------------ */
const polar = (cx, cy, r, ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]
const segAngle = (seg, n) => (seg / n) * 2 * Math.PI - Math.PI / 2

function slicePath(cx, cy, r, seg, n) {
  const a0 = segAngle(seg, n)
  const a1 = segAngle(seg + 1, n)
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const [ix0, iy0] = polar(cx, cy, r * INNER, a0)
  const [ix1, iy1] = polar(cx, cy, r * INNER, a1)
  return `M ${ix0} ${iy0} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} L ${ix1} ${iy1} A ${
    r * INNER
  } ${r * INNER} 0 0 0 ${ix0} ${iy0} Z`
}

/** Which segment (or -1) a point falls in, respecting the inner hole. */
function segmentAt(px, py, ring, n) {
  const dx = px - ring.cx
  const dy = py - ring.cy
  const dist = Math.hypot(dx, dy)
  if (dist < ring.r * INNER || dist > ring.r) return -1
  let a = Math.atan2(dy, dx) + Math.PI / 2
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return Math.floor(a / ((2 * Math.PI) / n)) % n
}

/* ------------------------------------------------------------------ */
/* Radial HUD menu — static; only re-renders when `active` changes.   */
/* ------------------------------------------------------------------ */
const RadialMenu = memo(function RadialMenu({ ring, segments, active, tint }) {
  const n = segments.length
  return (
    <g>
      {segments.map((seg, i) => {
        const on = i === active
        const [lx, ly] = polar(ring.cx, ring.cy, ring.r * 0.68, segAngle(i, n) + Math.PI / n)
        return (
          <g key={seg.key}>
            <path
              d={slicePath(ring.cx, ring.cy, ring.r, i, n)}
              fill={on ? tint.on : tint.off}
              stroke={on ? tint.stroke : 'rgba(255,255,255,0.12)'}
              strokeWidth={on ? 2.5 : 1}
              style={{ filter: on ? `drop-shadow(0 0 14px ${tint.stroke})` : 'none' }}
            />
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={on ? 34 : 28}
              fontWeight="800"
              fontFamily="Inter, sans-serif"
              fill={on ? '#fff' : 'rgba(255,255,255,0.7)'}
              style={{ pointerEvents: 'none' }}
            >
              {seg.text}
            </text>
          </g>
        )
      })}
      <circle cx={ring.cx} cy={ring.cy} r={ring.r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
      <circle
        cx={ring.cx}
        cy={ring.cy}
        r={ring.r * INNER}
        fill="rgba(6,4,15,0.35)"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth="1.5"
      />
    </g>
  )
})

/* ------------------------------------------------------------------ */
const symbolOf = (root, q) => (root >= 0 && q >= 0 ? ROOTS[root] + QUALITIES[q].suffix : null)
const labelOf = (root, q) => (root >= 0 && q >= 0 ? ROOTS[root] + QUALITIES[q].label : null)

export default function ARStudio() {
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState('idle') // idle | loading | running | error
  const [error, setError] = useState(null)

  // Discrete selection — drives ONLY the SVG highlight + bottom chip. Updated
  // from the loop only when a value actually changes (not every frame).
  const [sel, setSel] = useState({ root: -1, quality: -1, chord: null, playing: false })

  const webcamRef = useRef(null)
  const boxRef = useRef(null)
  const overlayRef = useRef(null)
  const landmarkerRef = useRef(null)
  const rafRef = useRef(null)
  const lastVideoTime = useRef(-1)
  const lock = useRef({ pendingKey: null, since: 0, playingKey: null, playingLabel: null })
  const lastSel = useRef({ root: -2, quality: -2, chord: '', playing: false })

  /* ---- per-frame canvas paint (no React) ---- */
  const paint = (fingers, dwell, playing, label) => {
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const s = canvas.width / VBW
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(s, s)

    // centre chord + lock ring
    const cx = VBW / 2
    const cy = VBH / 2
    ctx.beginPath()
    ctx.arc(cx, cy, 64, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(6,4,15,0.55)'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.stroke()
    if (label) {
      const frac = playing ? 1 : dwell
      ctx.beginPath()
      ctx.arc(cx, cy, 64, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.strokeStyle = playing ? '#34d399' : '#a78bfa'
      ctx.stroke()
    }
    ctx.fillStyle = label ? (playing ? '#34d399' : '#fff') : 'rgba(255,255,255,0.35)'
    ctx.font = '900 40px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label || '—', cx, cy)

    // fingertip cursors
    for (const f of fingers) {
      ctx.beginPath()
      ctx.arc(f.x, f.y, f.pinch ? 26 : 16, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(f.x, f.y, f.pinch ? 12 : 9, 0, Math.PI * 2)
      ctx.shadowColor = 'rgba(255,255,255,0.9)'
      ctx.shadowBlur = 8
      ctx.fillStyle = f.pinch ? '#34d399' : '#fff'
      ctx.fill()
      ctx.shadowBlur = 0
    }
  }

  /* ---- detection + audio + paint (runs every frame) ---- */
  const handle = (res) => {
    const hands = res.landmarks || []
    const fingers = []
    let root = -1
    let quality = -1
    for (const lmk of hands) {
      const tip = lmk[INDEX_TIP]
      const thumb = lmk[THUMB_TIP]
      const fx = (1 - tip.x) * VBW // mirror X to match the flipped video
      const fy = tip.y * VBH
      const pinch = Math.hypot(tip.x - thumb.x, tip.y - thumb.y) < PINCH
      fingers.push({ x: fx, y: fy, pinch })
      const lSeg = segmentAt(fx, fy, L, ROOTS.length)
      const rSeg = segmentAt(fx, fy, R, QUALITIES.length)
      if (lSeg >= 0) root = lSeg
      if (rSeg >= 0) quality = rSeg
    }

    const now = performance.now()
    const sym = symbolOf(root, quality)
    const label = labelOf(root, quality)
    const lk = lock.current

    // Track how long the current pointed-at combo has been stable.
    if (sym !== lk.pendingKey) {
      lk.pendingKey = sym
      lk.since = now
    }
    const stable = now - lk.since
    let dwell = 0

    if (sym) {
      if (sym === lk.playingKey) {
        dwell = 1
      } else {
        dwell = Math.min(1, stable / LOCK_MS)
        if (stable >= LOCK_MS) {
          startChord(sym) // sustains; releases the previous chord internally
          lk.playingKey = sym
          lk.playingLabel = label
        }
      }
    } else if (lk.playingKey && stable >= RELEASE_MS) {
      releaseChord()
      lk.playingKey = null
      lk.playingLabel = null
    }

    const playing = !!lk.playingKey
    const displayLabel = label || (playing ? lk.playingLabel : null)
    paint(fingers, dwell, playing, displayLabel)

    // Only nudge React when the discrete selection genuinely changes.
    const p = lastSel.current
    const chordStr = displayLabel || ''
    if (p.root !== root || p.quality !== quality || p.chord !== chordStr || p.playing !== playing) {
      lastSel.current = { root, quality, chord: chordStr, playing }
      setSel({ root, quality, chord: displayLabel, playing })
    }
  }

  const loop = useCallback(() => {
    const lm = landmarkerRef.current
    const video = webcamRef.current?.video
    if (lm && video && video.readyState >= 2 && video.currentTime !== lastVideoTime.current) {
      lastVideoTime.current = video.currentTime
      let res
      try {
        res = lm.detectForVideo(video, performance.now())
      } catch {
        res = null
      }
      if (res) handle(res)
    }
    rafRef.current = requestAnimationFrame(loop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- keep the canvas backing store sized to the box ---- */
  useEffect(() => {
    if (!active) return
    const box = boxRef.current
    const canvas = overlayRef.current
    if (!box || !canvas) return
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = box.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [active])

  /* ---- start / stop ---- */
  const start = async () => {
    setError(null)
    setStatus('loading')
    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
      let landmarker
      const opts = { runningMode: 'VIDEO', numHands: 2 }
      try {
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          ...opts,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        })
      } catch {
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          ...opts,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        })
      }
      landmarkerRef.current = landmarker
      setActive(true)
      setStatus('running')
      rafRef.current = requestAnimationFrame(loop)
    } catch {
      setStatus('error')
      setError('Could not load the hand-tracking model. Check your connection and try again.')
    }
  }

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    releaseChord()
    landmarkerRef.current?.close?.()
    landmarkerRef.current = null
    lastVideoTime.current = -1
    lock.current = { pendingKey: null, since: 0, playingKey: null, playingLabel: null }
    lastSel.current = { root: -2, quality: -2, chord: '', playing: false }
    setActive(false)
    setStatus('idle')
    setSel({ root: -1, quality: -1, chord: null, playing: false })
  }, [])

  useEffect(() => () => stop(), [stop])

  const onCamError = () => {
    setStatus('error')
    setError('Camera access denied. Allow webcam permission to use AR Studio.')
    stop()
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="glass p-5 sm:p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">
              <span className="text-accent-400">✋</span> AR Studio
              <span className="chip text-white/50 text-xs">hand-gesture chords</span>
            </h2>
            <p className="text-xs text-white/40 mt-1 max-w-lg">
              Point your <span className="text-accent-300">left-hand</span> finger at a root note and your{' '}
              <span className="text-sky-300">right-hand</span> finger at a quality. Hold to lock — the chord keeps
              ringing until you move your finger away.
            </p>
          </div>
          <button
            onClick={active ? stop : start}
            disabled={status === 'loading'}
            className={active ? 'btn-ghost' : 'btn-primary'}
          >
            {status === 'loading' ? '… Loading' : active ? '■ Stop' : '● Start Camera'}
          </button>
        </div>
        {error && <p className="text-rose-300 text-sm mt-3">{error}</p>}
      </div>

      {/* Stage */}
      <div className="glass p-2 sm:p-3">
        <div ref={boxRef} className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-black/60">
          {active ? (
            <>
              <Webcam
                ref={webcamRef}
                audio={false}
                mirrored={false}
                onUserMediaError={onCamError}
                videoConstraints={{ facingMode: 'user', aspectRatio: 4 / 3 }}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />

              {/* static labelled menus */}
              <svg
                viewBox={`0 0 ${VBW} ${VBH}`}
                preserveAspectRatio="xMidYMid meet"
                className="absolute inset-0 w-full h-full pointer-events-none"
              >
                <RadialMenu ring={L} active={sel.root} segments={ROOT_SEGMENTS} tint={L_TINT} />
                <RadialMenu ring={R} active={sel.quality} segments={QUALITY_SEGMENTS} tint={R_TINT} />
              </svg>

              {/* fast-moving cursors / lock ring / centre chord */}
              <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            </>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-center px-6">
              <div>
                <div className="text-5xl mb-3">✋🎸</div>
                <p className="text-white/60 text-sm max-w-sm mx-auto">
                  {status === 'loading'
                    ? 'Loading the hand-tracking model…'
                    : 'Press “Start Camera” and allow webcam access. Everything runs locally in your browser.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live chord chip */}
      <div className="flex items-center justify-center gap-3 text-sm">
        <span className="text-white/40">{sel.playing ? 'Now playing:' : 'Now forming:'}</span>
        <motion.span
          key={sel.chord || 'none'}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`font-mono font-black text-xl ${
            sel.playing ? 'text-mint-400' : sel.chord ? 'text-accent-400' : 'text-white/30'
          }`}
        >
          {sel.chord || '—'}
        </motion.span>
      </div>
    </div>
  )
}
