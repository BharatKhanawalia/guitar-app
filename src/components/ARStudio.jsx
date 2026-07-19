import { useRef, useState, useEffect, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Webcam from 'react-webcam'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import {
  boot as _b,
  holdChord,
  releaseChord,
  holdNote,
  releaseNote,
  stopAll,
  setInstrument,
  setWave,
  setVolume,
  chordNotes,
  scaleNotes,
  INSTRUMENTS,
  INSTRUMENT_KEYS,
  SCALES,
  WAVES,
} from '../lib/arSynth'
import { Note } from 'tonal'
import { rangeFill } from '../lib/ui'

/**
 * ARStudio — an in-air, hand-gesture instrument (inspired by sound.gojaehyun.com).
 * The whole studio fits the viewport (no scroll): compact header, a large centred
 * camera stage with an in-frame start overlay, and a control bar pinned below.
 *
 *   • Two-hand Chord — left ring picks a ROOT, right ring picks a QUALITY.
 *   • Melody + Chord — left ring holds a chord; the right side is either a scale
 *     BAR or a chromatic virtual PIANO you play single notes on.
 */

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const ROOTS_12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const ROOTS_7 = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const QUALITIES = [
  { label: 'maj', suffix: '' },
  { label: 'maj7', suffix: 'maj7' },
  { label: '7', suffix: '7' },
  { label: 'sus4', suffix: 'sus4' },
  { label: 'm', suffix: 'm' },
  { label: 'm7', suffix: 'm7' },
  { label: 'dim', suffix: 'dim' },
  { label: 'aug', suffix: 'aug' },
]
const WAVE_INSTRUMENTS = new Set(['woo', 'aurora', 'synth']) // Wave selector only matters here
const L_TINT = { on: 'rgba(139,92,246,0.55)', off: 'rgba(139,92,246,0.12)', stroke: '#a78bfa' }
const R_TINT = { on: 'rgba(56,189,248,0.55)', off: 'rgba(56,189,248,0.12)', stroke: '#38bdf8' }

// Overlay coordinate space (4:3).
const VBW = 1000
const VBH = 750
// Interactive elements are vertically centred (hand tracking is most reliable in
// the middle of the frame).
const CENTER_Y = 375
const CHORD_L = { cx: 250, cy: CENTER_Y, r: 205 }
const CHORD_R = { cx: 750, cy: CENTER_Y, r: 205 }
const MEL_L = { cx: 220, cy: CENTER_Y, r: 185 }
const BAR = { x0: 418, x1: 996, y0: 300, y1: 470 }
const PIANO = { x0: 414, x1: 996, y0: 235, y1: 545 }

// Octave window selector: value = start octave for a 2-octave window; 0 = full 2–5.
const OCT_OPTIONS = [
  [1, 'Oct 1–2'], [2, 'Oct 2–3'], [3, 'Oct 3–4'], [4, 'Oct 4–5'], [5, 'Oct 5–6'], [0, 'Full (2–5)'],
]
const octRange = (v) => (v === 0 ? { startOctave: 2, octaves: 4 } : { startOctave: v, octaves: 2 })
const INNER = 0.34
// Hand detection is the single heaviest cost (neural net inference per frame). On a
// fanless M1 Air, running it at 60 fps on a 720p feed cooks the machine. We cap
// detection at ~24 fps and request a small 480p feed — smooth enough for gestures,
// dramatically cooler.
const DETECT_INTERVAL = 42 // ms → ~24 fps
const LOCK_MS = 120
const RELEASE_MS = 100
const PINCH = 0.06
const INDEX_TIP = 8
const THUMB_TIP = 4

/* ---- geometry ---- */
const polar = (cx, cy, r, ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]
const segAngle = (seg, n) => (seg / n) * 2 * Math.PI - Math.PI / 2
function slicePath(cx, cy, r, seg, n) {
  const a0 = segAngle(seg, n)
  const a1 = segAngle(seg + 1, n)
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const [ix0, iy0] = polar(cx, cy, r * INNER, a0)
  const [ix1, iy1] = polar(cx, cy, r * INNER, a1)
  return `M ${ix0} ${iy0} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} L ${ix1} ${iy1} A ${r * INNER} ${r * INNER} 0 0 0 ${ix0} ${iy0} Z`
}
function segmentAt(px, py, ring, n) {
  const dx = px - ring.cx
  const dy = py - ring.cy
  const dist = Math.hypot(dx, dy)
  if (dist < ring.r * INNER || dist > ring.r) return -1
  let a = Math.atan2(dy, dx) + Math.PI / 2
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return Math.floor(a / ((2 * Math.PI) / n)) % n
}
function barCellAt(px, py, count) {
  if (px < BAR.x0 || px > BAR.x1 || py < BAR.y0 || py > BAR.y1) return -1
  const w = (BAR.x1 - BAR.x0) / count
  return Math.min(count - 1, Math.floor((px - BAR.x0) / w))
}

/* ---- piano geometry ---- */
const WHITE_LOCAL = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const WHITE_SEMI = [0, 2, 4, 5, 7, 9, 11]
const BLACK_AFTER = [0, 1, 3, 4, 5] // white-local indices that have a black key to their right
const BLACK_NAME = { 0: 'C#', 1: 'D#', 3: 'F#', 4: 'G#', 5: 'A#' }
function pianoKeyAt(px, py, startOct, octaves) {
  if (px < PIANO.x0 || px > PIANO.x1 || py < PIANO.y0 || py > PIANO.y1) return null
  const nWhite = 7 * octaves
  const whiteW = (PIANO.x1 - PIANO.x0) / nWhite
  const blackH = (PIANO.y1 - PIANO.y0) * 0.6
  const blackW = whiteW * 0.62
  if (py < PIANO.y0 + blackH) {
    for (let o = 0; o < octaves; o++)
      for (const bl of BLACK_AFTER) {
        const cx = PIANO.x0 + (o * 7 + bl + 1) * whiteW
        if (Math.abs(px - cx) < blackW / 2) return BLACK_NAME[bl] + (startOct + o)
      }
  }
  const wi = Math.min(nWhite - 1, Math.floor((px - PIANO.x0) / whiteW))
  return WHITE_LOCAL[wi % 7] + (startOct + Math.floor(wi / 7))
}

/* ---- radial menu (memoised) ---- */
const RadialMenu = memo(function RadialMenu({ ring, segments, active, tint }) {
  const n = segments.length
  return (
    <g>
      {segments.map((seg, i) => {
        const on = i === active
        const [lx, ly] = polar(ring.cx, ring.cy, ring.r * 0.72, segAngle(i, n) + Math.PI / n)
        return (
          <g key={seg}>
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
              fontSize={on ? 30 : n > 8 ? 20 : 26}
              fontWeight="800"
              fontFamily="Inter, sans-serif"
              fill={on ? '#fff' : 'rgba(255,255,255,0.72)'}
              style={{ pointerEvents: 'none' }}
            >
              {seg}
            </text>
          </g>
        )
      })}
      <circle cx={ring.cx} cy={ring.cy} r={ring.r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
      <circle cx={ring.cx} cy={ring.cy} r={ring.r * INNER} fill="rgba(6,4,15,0.35)" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
    </g>
  )
})

/* ---- melody bar (memoised) ---- */
const MelodyBar = memo(function MelodyBar({ notes, active, chordPcs }) {
  const w = (BAR.x1 - BAR.x0) / notes.length
  return (
    <g>
      {notes.map((note, i) => {
        const on = i === active
        const pc = ((Note.chroma(note) ?? -1) + 12) % 12
        const inChord = chordPcs.includes(pc)
        return (
          <g key={i}>
            <rect
              x={BAR.x0 + i * w}
              y={BAR.y0}
              width={w - 2}
              height={BAR.y1 - BAR.y0}
              rx="6"
              fill={on ? 'rgba(56,189,248,0.6)' : inChord ? 'rgba(139,92,246,0.32)' : 'rgba(255,255,255,0.06)'}
              stroke={on ? '#38bdf8' : inChord ? '#a78bfa' : 'rgba(255,255,255,0.12)'}
              strokeWidth={on ? 2.5 : 1}
              style={{ filter: on ? 'drop-shadow(0 0 12px #38bdf8)' : 'none' }}
            />
            <text
              x={BAR.x0 + i * w + w / 2}
              y={BAR.y1 - 16}
              textAnchor="middle"
              fontSize="18"
              fontWeight="700"
              fontFamily="Inter, sans-serif"
              fill={on || inChord ? '#fff' : 'rgba(255,255,255,0.65)'}
              style={{ pointerEvents: 'none' }}
            >
              {note.replace(/(\d)/, '')}
              <tspan fontSize="12" fill="rgba(255,255,255,0.45)">{note.match(/\d/)?.[0]}</tspan>
            </text>
          </g>
        )
      })}
    </g>
  )
})

/* ---- virtual piano (memoised) ---- */
const PianoKeyboard = memo(function PianoKeyboard({ startOct, octaves, activeNote, chordPcs }) {
  const nWhite = 7 * octaves
  const whiteW = (PIANO.x1 - PIANO.x0) / nWhite
  const blackH = (PIANO.y1 - PIANO.y0) * 0.6
  const blackW = whiteW * 0.62
  const whites = []
  const blacks = []
  for (let o = 0; o < octaves; o++) {
    for (let i = 0; i < 7; i++) {
      whites.push({ x: PIANO.x0 + (o * 7 + i) * whiteW, note: WHITE_LOCAL[i] + (startOct + o), pc: WHITE_SEMI[i] })
    }
    for (const bl of BLACK_AFTER) {
      blacks.push({ cx: PIANO.x0 + (o * 7 + bl + 1) * whiteW, note: BLACK_NAME[bl] + (startOct + o), pc: (WHITE_SEMI[bl] + 1) % 12 })
    }
  }
  return (
    <g>
      {whites.map((k, i) => {
        const on = k.note === activeNote
        const inC = chordPcs.includes(k.pc)
        return (
          <g key={'w' + i}>
            <rect
              x={k.x + 1}
              y={PIANO.y0}
              width={whiteW - 2}
              height={PIANO.y1 - PIANO.y0}
              rx="4"
              fill={on ? 'rgba(56,189,248,0.6)' : inC ? 'rgba(139,92,246,0.32)' : 'rgba(255,255,255,0.18)'}
              stroke={on ? '#38bdf8' : 'rgba(255,255,255,0.28)'}
              strokeWidth={on ? 2.5 : 1}
              style={{ filter: on ? 'drop-shadow(0 0 12px #38bdf8)' : 'none' }}
            />
            <text x={k.x + whiteW / 2} y={PIANO.y1 - 12} textAnchor="middle" fontSize="12" fontWeight="700" fill={on || inC ? '#fff' : 'rgba(15,15,25,0.65)'} style={{ pointerEvents: 'none' }}>
              {k.note.replace(/\d/, '')}
              <tspan fontSize="8" dy="1">{k.note.match(/\d/)?.[0]}</tspan>
            </text>
          </g>
        )
      })}
      {blacks.map((k, i) => {
        const on = k.note === activeNote
        const inC = chordPcs.includes(k.pc)
        return (
          <rect
            key={'b' + i}
            x={k.cx - blackW / 2}
            y={PIANO.y0}
            width={blackW}
            height={blackH}
            rx="3"
            fill={on ? 'rgba(56,189,248,0.9)' : inC ? 'rgba(139,92,246,0.72)' : 'rgba(8,8,16,0.82)'}
            stroke={on ? '#38bdf8' : 'rgba(255,255,255,0.22)'}
            strokeWidth={on ? 2 : 1}
            style={{ filter: on ? 'drop-shadow(0 0 12px #38bdf8)' : 'none' }}
          />
        )
      })}
    </g>
  )
})

export default function ARStudio() {
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)

  // Settings
  const [mode, setMode] = useState('chord') // 'chord' | 'melody'
  const [instrument, setInst] = useState('woo')
  const [scale, setScale] = useState('Minor')
  const [wave, setWaveState] = useState('triangle')
  const [octStart, setOctStart] = useState(3) // melody octave window (start); 0 = full
  const [simple, setSimple] = useState(false)
  const [snap, setSnap] = useState(true)
  const [leftOctave, setLeftOctave] = useState(3)
  const [virtualPiano, setVirtualPiano] = useState(false)
  const [volume, setVol] = useState(0) // 0 dB = max by default
  const [showHelp, setShowHelp] = useState(false)
  const [entered, setEntered] = useState(false) // full-screen studio overlay

  const [sel, setSel] = useState({ root: -1, quality: -1, chord: null, playing: false, melody: -1, note: null, hands: 0, rPinch: false })

  const webcamRef = useRef(null)
  const boxRef = useRef(null)
  const stageRef = useRef(null)
  const overlayRef = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const landmarkerRef = useRef(null)
  const rafRef = useRef(null)
  const lastVideoTime = useRef(-1)
  const lastDetect = useRef(0)
  const lock = useRef({ pendingKey: null, since: 0, playingKey: null, playingLabel: null })
  const lastSel = useRef({})
  const cfg = useRef({})
  cfg.current = { mode, instrument, scale, octStart, simple, leftOctave, virtualPiano }

  const roots = simple ? ROOTS_7 : ROOTS_12
  const mel = octRange(octStart)
  const melodyBarNotes = scaleNotes('C', SCALES[scale] || 'minor', mel.octaves, mel.startOctave)
  const showWave = WAVE_INSTRUMENTS.has(instrument)

  /* ---- apply instrument / wave / volume live ---- */
  useEffect(() => { setInstrument(instrument) }, [instrument])
  useEffect(() => { setWave(wave) }, [wave])
  useEffect(() => { setVolume(volume) }, [volume])

  /* ---- per-frame canvas paint ---- */
  const paint = (fingers, dwell, playing, label) => {
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const s = canvas.width / VBW
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(s, s)
    const cx = cfg.current.mode === 'melody' ? MEL_L.cx : VBW / 2
    const cy = CENTER_Y
    ctx.beginPath(); ctx.arc(cx, cy, 62, 0, Math.PI * 2); ctx.fillStyle = 'rgba(6,4,15,0.55)'; ctx.fill()
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.stroke()
    if (label) {
      const frac = playing ? 1 : dwell
      ctx.beginPath(); ctx.arc(cx, cy, 62, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
      ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.strokeStyle = playing ? '#34d399' : '#a78bfa'; ctx.stroke()
    }
    ctx.fillStyle = label ? (playing ? '#34d399' : '#fff') : 'rgba(255,255,255,0.35)'
    ctx.font = '900 34px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(label || '—', cx, cy)
    for (const f of fingers) {
      ctx.beginPath(); ctx.arc(f.x, f.y, f.pinch ? 26 : 16, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill()
      ctx.beginPath(); ctx.arc(f.x, f.y, f.pinch ? 12 : 9, 0, Math.PI * 2)
      ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 8; ctx.fillStyle = f.pinch ? '#34d399' : '#fff'; ctx.fill(); ctx.shadowBlur = 0
    }
  }

  /* ---- detection ---- */
  const handle = (res) => {
    const c = cfg.current
    const rootList = c.simple ? ROOTS_7 : ROOTS_12
    const win = octRange(c.octStart)
    const barNotes = scaleNotes('C', SCALES[c.scale] || 'minor', win.octaves, win.startOctave)
    const hands = res.landmarks || []
    const fingers = []
    let root = -1
    let quality = -1
    let melodyCell = -1
    let melodyNote = null
    let rPinch = false
    for (const lmk of hands) {
      const tip = lmk[INDEX_TIP]
      const thumb = lmk[THUMB_TIP]
      const fx = (1 - tip.x) * VBW
      const fy = tip.y * VBH
      const pinch = Math.hypot(tip.x - thumb.x, tip.y - thumb.y) < PINCH
      fingers.push({ x: fx, y: fy, pinch })
      if (c.mode === 'melody') {
        const lSeg = segmentAt(fx, fy, MEL_L, rootList.length)
        if (lSeg >= 0) root = lSeg
        if (c.virtualPiano) {
          const key = pianoKeyAt(fx, fy, win.startOctave, win.octaves)
          if (key) { melodyNote = key; if (pinch) rPinch = true }
        } else {
          const cell = barCellAt(fx, fy, barNotes.length)
          if (cell >= 0) { melodyCell = cell; melodyNote = barNotes[cell]; if (pinch) rPinch = true }
        }
      } else {
        const lSeg = segmentAt(fx, fy, CHORD_L, rootList.length)
        const rSeg = segmentAt(fx, fy, CHORD_R, QUALITIES.length)
        if (lSeg >= 0) root = lSeg
        if (rSeg >= 0) quality = rSeg
      }
    }

    // Left hand alone → MAJOR; right ring overrides quality (chord mode only).
    const now = performance.now()
    const qIdx = c.mode !== 'melody' && quality >= 0 ? quality : root >= 0 ? 0 : -1
    const sym = root >= 0 && qIdx >= 0 ? rootList[root] + QUALITIES[qIdx].suffix : null
    const label = root >= 0 && qIdx >= 0 ? rootList[root] + QUALITIES[qIdx].label : null
    const lk = lock.current
    if (sym !== lk.pendingKey) { lk.pendingKey = sym; lk.since = now }
    const stable = now - lk.since
    let dwell = 0
    if (sym) {
      if (sym === lk.playingKey) dwell = 1
      else {
        dwell = Math.min(1, stable / LOCK_MS)
        if (stable >= LOCK_MS) { holdChord(chordNotes(rootList[root], QUALITIES[qIdx].suffix, c.leftOctave)); lk.playingKey = sym; lk.playingLabel = label }
      }
    } else if (lk.playingKey && stable >= RELEASE_MS) { releaseChord(); lk.playingKey = null; lk.playingLabel = null }

    // Melody note (bar or piano)
    if (c.mode === 'melody') {
      if (melodyNote) holdNote(melodyNote)
      else releaseNote()
    }

    const playing = !!lk.playingKey
    const displayLabel = label || (playing ? lk.playingLabel : null)
    paint(fingers, dwell, playing, displayLabel)

    const p = lastSel.current
    if (
      p.root !== root || p.quality !== qIdx || p.chord !== (displayLabel || '') ||
      p.playing !== playing || p.melody !== melodyCell || p.note !== (melodyNote || '') ||
      p.hands !== hands.length || p.rPinch !== rPinch
    ) {
      lastSel.current = { root, quality: qIdx, chord: displayLabel || '', playing, melody: melodyCell, note: melodyNote || '', hands: hands.length, rPinch }
      setSel({ root, quality: qIdx, chord: displayLabel, playing, melody: melodyCell, note: melodyNote, hands: hands.length, rPinch })
    }
  }

  const loop = useCallback(() => {
    const lm = landmarkerRef.current
    const video = webcamRef.current?.video
    const now = performance.now()
    // Throttle the expensive detection to ~24 fps (still runs on real video frames).
    if (
      lm && video && video.readyState >= 2 &&
      now - lastDetect.current >= DETECT_INTERVAL &&
      video.currentTime !== lastVideoTime.current
    ) {
      lastDetect.current = now
      lastVideoTime.current = video.currentTime
      let r
      try { r = lm.detectForVideo(video, now) } catch { r = null }
      if (r) handle(r)
    }
    rafRef.current = requestAnimationFrame(loop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Size the 4:3 camera box to fill the available stage height/width. The box's
  // children are all absolutely-positioned, so it has no intrinsic size — we must
  // compute it, or it collapses. Runs whenever the studio is open.
  useEffect(() => {
    if (!entered) return
    const stage = stageRef.current
    if (!stage) return
    const fit = () => {
      const r = stage.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) return
      const w = Math.min(r.width, (r.height * 4) / 3)
      setBox({ w: Math.floor(w), h: Math.floor((w * 3) / 4) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [entered])

  // Keep the overlay canvas backing-store matched to the box's pixel size.
  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas || !box.w) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(box.w * dpr))
    canvas.height = Math.max(1, Math.round(box.h * dpr))
  }, [box, active])

  const start = async () => {
    setError(null)
    setStatus('loading')
    try {
      _b()
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
      const opts = { runningMode: 'VIDEO', numHands: 2 }
      let lm
      try {
        lm = await HandLandmarker.createFromOptions(fileset, { ...opts, baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' } })
      } catch {
        lm = await HandLandmarker.createFromOptions(fileset, { ...opts, baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' } })
      }
      landmarkerRef.current = lm
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
    stopAll()
    landmarkerRef.current?.close?.()
    landmarkerRef.current = null
    lastVideoTime.current = -1
    lock.current = { pendingKey: null, since: 0, playingKey: null, playingLabel: null }
    lastSel.current = {}
    setActive(false)
    setStatus('idle')
    setSel({ root: -1, quality: -1, chord: null, playing: false, melody: -1, note: null, hands: 0, rPinch: false })
  }, [])

  useEffect(() => () => stop(), [stop])
  const exit = useCallback(() => { stop(); setEntered(false) }, [stop])
  // Esc exits the full-screen studio.
  useEffect(() => {
    if (!entered) return
    const onKey = (e) => { if (e.key === 'Escape') exit() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entered, exit])
  const onCamError = () => { setStatus('error'); setError('Camera access denied. Allow webcam permission to use AR Studio.'); stop() }

  const chordPcs = sel.chord && sel.root >= 0
    ? chordNotes(roots[sel.root], QUALITIES[mode === 'melody' ? 0 : Math.max(0, sel.quality)].suffix).map((nn) => ((Note.chroma(nn) ?? -1) + 12) % 12)
    : []
  const melodyHz = sel.note ? Note.freq(sel.note)?.toFixed(0) : '—'

  // ---- Launch card (shown in the normal tab; keeps the page tidy) ----
  if (!entered) {
    return (
      <div className="max-w-3xl mx-auto">
        {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
        <div className="glass p-8 sm:p-12 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-accent-500/10 via-transparent to-sky-500/10 pointer-events-none" />
          <div className="relative">
            <div className="text-7xl mb-4">✋✨</div>
            <h2 className="text-3xl font-black bg-gradient-to-r from-accent-300 to-sky-300 bg-clip-text text-transparent mb-3">AR Studio</h2>
            <p className="text-white/60 text-sm max-w-md mx-auto mb-8">
              Play music in the air with your hands. A gesture instrument with real instruments, a virtual piano,
              and endless sustaining chords — opens full-screen for a distraction-free studio. Everything runs
              locally in your browser.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => setEntered(true)} className="btn-primary !px-7 !py-3 text-base">Enter AR Studio →</button>
              <button
                onClick={() => setShowHelp(true)}
                className="w-11 h-11 grid place-items-center rounded-full border border-accent-400/40 text-accent-300 hover:bg-accent-500/15 transition"
                title="How does it work?"
                aria-label="Help"
              >
                <span className="text-lg font-bold">?</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- Full-screen studio overlay (scroll-free by construction) ----
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#07040f] p-3 sm:p-4">
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}

      {/* Compact header */}
      <div className="flex items-center justify-between gap-3 mb-2 shrink-0">
        <h2 className="font-bold text-base sm:text-lg flex items-center gap-2">
          <span className="text-accent-400">✋</span> AR Studio
          <span className="chip text-white/50 text-[11px] hidden sm:inline">gesture instrument</span>
          {active && sel.chord && (
            <span className={`font-mono font-black text-lg ml-1 ${sel.playing ? 'text-mint-400' : 'text-accent-400'}`}>{sel.chord}</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHelp(true)}
            className="w-8 h-8 grid place-items-center rounded-full border border-accent-400/40 text-accent-300 hover:bg-accent-500/15 hover:border-accent-400/70 transition"
            title="How does AR Studio work?"
            aria-label="Help"
          >
            <span className="text-base font-bold">?</span>
          </button>
          <button onClick={exit} className="btn-ghost !py-1.5 !px-3 text-sm" title="Exit studio (Esc)">✕ Exit</button>
        </div>
      </div>

      {/* Stage — fills remaining height, 4:3 box centred (sized in JS) */}
      <div ref={stageRef} className="flex-1 min-h-0 flex items-center justify-center">
        <div
          ref={boxRef}
          style={{ width: box.w ? `${box.w}px` : '100%', height: box.h ? `${box.h}px` : '100%' }}
          className="relative rounded-2xl overflow-hidden bg-black/70 border border-white/10 shadow-glow"
        >
          {active && (
            <>
              <Webcam
                ref={webcamRef}
                audio={false}
                mirrored={false}
                onUserMediaError={onCamError}
                videoConstraints={{ facingMode: 'user', aspectRatio: 4 / 3, width: { ideal: 640 }, height: { ideal: 480 } }}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
              <svg viewBox={`0 0 ${VBW} ${VBH}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full pointer-events-none">
                {mode === 'chord' ? (
                  <>
                    <RadialMenu ring={CHORD_L} active={sel.root} segments={roots} tint={L_TINT} />
                    <RadialMenu ring={CHORD_R} active={sel.quality} segments={QUALITIES.map((q) => q.label)} tint={R_TINT} />
                  </>
                ) : (
                  <>
                    <RadialMenu ring={MEL_L} active={sel.root} segments={roots} tint={L_TINT} />
                    {virtualPiano ? (
                      <PianoKeyboard startOct={mel.startOctave} octaves={mel.octaves} activeNote={sel.note} chordPcs={chordPcs} />
                    ) : (
                      <MelodyBar notes={melodyBarNotes} active={sel.melody} chordPcs={chordPcs} />
                    )}
                  </>
                )}
              </svg>
              <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />

              {/* Info box (top-right) */}
              <div className="absolute top-3 right-3 font-mono text-[11px] leading-relaxed bg-black/55 border border-white/10 rounded-xl px-3 py-2 text-white/70 pointer-events-none">
                <div>Melody: <span className="text-sky-300">{melodyHz}</span> Hz</div>
                <div>Volume: <span className="text-mint-300">{volume} dB</span></div>
                <div>R-Pinch: <span className={sel.rPinch ? 'text-mint-300' : 'text-white/40'}>{sel.rPinch ? 'yes' : '—'}</span></div>
                <div>Chord: <span className="text-accent-300">{sel.chord || '—'}</span></div>
                <div>Hands: <span className="text-white/90">{sel.hands}</span></div>
              </div>
            </>
          )}

          {/* In-frame start overlay (disappears once the camera is live) */}
          {!active && (
            <div className="absolute inset-0 grid place-items-center text-center px-6 bg-gradient-to-b from-black/40 via-black/20 to-black/50">
              <div className="max-w-md">
                <div className="text-6xl mb-4">✋✨</div>
                <h3 className="text-2xl font-black bg-gradient-to-r from-accent-300 to-sky-300 bg-clip-text text-transparent mb-2">AR Studio</h3>
                <p className="text-white/70 text-sm mb-6">
                  Play music in the air with your hands. Point a finger at a glowing ring and hold to lock —
                  the chord <span className="text-mint-300">sustains forever</span> until you move away.
                  Everything runs locally in your browser.
                </p>
                <button onClick={start} disabled={status === 'loading'} className="btn-primary !px-6 !py-3 text-base">
                  {status === 'loading' ? '… Loading model' : '● Start Camera'}
                </button>
                {error && <p className="text-rose-300 text-sm mt-4">{error}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Control bar (pinned below the stage) */}
      <div className="shrink-0 mt-2 glass p-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
        <Ctl label="Mode">
          <UpSelect value={mode} onChange={setMode} opts={[['chord', 'Two-hand Chord'], ['melody', 'Melody + Chord']]} />
        </Ctl>
        <Ctl label="Instrument">
          <UpSelect value={instrument} onChange={setInst} opts={INSTRUMENT_KEYS.map((k) => [k, INSTRUMENTS[k].label])} />
        </Ctl>
        <Ctl label="Chord Oct">
          <UpSelect value={leftOctave} onChange={(v) => setLeftOctave(+v)} opts={[[2, 'Low (2)'], [3, 'Mid (3)'], [4, 'High (4)']]} />
        </Ctl>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={simple} onChange={(e) => setSimple(e.target.checked)} className="accent-accent-500" /> Simple
        </label>

        {mode === 'melody' && (
          <>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={virtualPiano} onChange={(e) => setVirtualPiano(e.target.checked)} className="accent-accent-500" /> Virtual Piano UI
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} className="accent-accent-500" /> Snap
            </label>
            <Ctl label="Scale">
              <UpSelect value={scale} onChange={setScale} disabled={virtualPiano} opts={Object.keys(SCALES).map((k) => [k, k])} />
            </Ctl>
            <Ctl label="Octaves">
              <UpSelect value={octStart} onChange={(v) => setOctStart(+v)} opts={OCT_OPTIONS} />
            </Ctl>
          </>
        )}

        {showWave && (
          <Ctl label="Wave">
            <UpSelect value={wave} onChange={setWaveState} opts={WAVES.map((w) => [w, w])} />
          </Ctl>
        )}

        <label className="flex items-center gap-2">
          <span className="text-white/40 text-xs">Vol</span>
          <input type="range" min={-30} max={0} step={1} value={volume} onChange={(e) => setVol(+e.target.value)} style={rangeFill(volume, -30, 0)} className="w-20" />
        </label>
      </div>
    </div>
  )
}

/* ---- small control primitives ---- */
function Ctl({ label, children }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-white/40 text-xs whitespace-nowrap">{label}</span>
      {children}
    </div>
  )
}
// A dropdown that opens UPWARD (the control bar lives at the bottom of the screen,
// so a native <select> would drop its list off-screen). Scrolls if the list is tall.
function UpSelect({ value, onChange, opts, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const cur = opts.find((o) => String(o[0]) === String(value))
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 bg-black/40 border rounded-lg px-2.5 py-1.5 text-sm outline-none whitespace-nowrap ${
          open ? 'border-accent-400/60' : 'border-white/10'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-white/25'}`}
      >
        <span>{cur ? cur[1] : value}</span>
        <span className="text-[9px] text-white/50">▲</span>
      </button>
      {open && !disabled && (
        <div className="absolute bottom-full left-0 mb-1.5 min-w-full max-h-[60vh] overflow-y-auto rounded-xl border border-white/20 bg-[#14101f] shadow-2xl z-50 py-1">
          {opts.map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => { onChange(v); setOpen(false) }}
              className={`block w-full text-left px-3 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-accent-500/25 ${
                String(v) === String(value) ? 'text-accent-300 font-semibold' : 'text-white/80'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---- friendly tutorial dialog ---- */
const HELP_SECTIONS = [
  { icon: '✋', title: 'Move your hands', body: 'Your webcam tracks your fingertips. Point your index finger at a glowing ring and hold for a moment to lock it — the sound then sustains until you move away.' },
  { icon: '🎵', title: 'Two-hand Chord mode', body: 'Left hand picks the root note (C, D, E…). Right hand picks the flavour (major, minor, 7…). Just the left hand alone plays a major chord — bring in the right hand only when you want a different flavour.' },
  { icon: '🎹', title: 'Melody + Chord mode', body: 'Left hand holds a chord; the right side plays single notes. Toggle "Virtual Piano UI" to swap the scale bar for a real chromatic keyboard. Notes glowing purple are the ones inside your held chord.' },
  { icon: '🎚️', title: 'Chord Octave', body: 'Sets how high or low the backing chords (left circle) sound, independently of the melody. Handy to keep the pad out of the way of your tune.' },
  { icon: '🎻', title: 'Instrument', body: 'Pick any voice — the dreamy “Woo”, a real acoustic guitar (full strum), piano, organ, harmonium, strings and more.' },
  { icon: '〰️', title: 'Wave & Scale', body: 'Wave shapes the synth voices (Sine soft, Triangle mellow, Saw bright, Square retro). Scale sets the melody-bar notes — but it’s disabled in Virtual Piano mode, since a keyboard is always chromatic.' },
]
function HelpDialog({ onClose }) {
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="glass max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 rounded-2xl border border-accent-400/25"
          initial={{ scale: 0.92, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-xl font-black bg-gradient-to-r from-accent-300 to-sky-300 bg-clip-text text-transparent">Playing the AR Studio</h3>
              <p className="text-white/45 text-sm mt-1">Make music in the air with your hands — no instrument needed.</p>
            </div>
            <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none -mt-1" aria-label="Close">×</button>
          </div>
          <div className="space-y-3">
            {HELP_SECTIONS.map((s) => (
              <div key={s.title} className="flex gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/5">
                <div className="text-2xl shrink-0">{s.icon}</div>
                <div>
                  <div className="font-bold text-sm text-white/90">{s.title}</div>
                  <div className="text-sm text-white/55 leading-relaxed mt-0.5">{s.body}</div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={onClose} className="btn-primary w-full mt-5">Got it — let’s play ✨</button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
