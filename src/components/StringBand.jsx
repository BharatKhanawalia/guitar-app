import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Note } from 'tonal'
import { pluckNote } from '../lib/stringPluck'

/**
 * StringBand — the homepage's 6-string neon band. Visually identical to before
 * (six faint horizontal strings with a coloured glow "bead" plucking along each
 * one), now a hybrid instrument:
 *   • HARP GLIDE — sweep the cursor across the strings and each one you cross
 *     rings its note (one trigger per crossing, gentle). The strings are tuned
 *     to a lush chord voicing, and re-tune to a fresh random one after each
 *     strum, so it never repeats the same chord.
 *   • PLUCK — press and drag a string, pull it, release: it snaps back and
 *     oscillates as a damped standing wave while its note rings out.
 *
 * The strings are drawn in one SVG so a string can bend/vibrate; the beads stay
 * as DOM spans with the original `gt-pluck` animation. Rest state renders as
 * perfectly straight, faded lines, matching the previous look exactly.
 */

// Per-string bead colour / speed / delay (unchanged from the original band).
const STRINGS = [
  { color: 'var(--gt-accent2)', dur: '5.5s', delay: '0s' },
  { color: 'var(--gt-mint)', dur: '6.4s', delay: '0.9s' },
  { color: 'var(--gt-accent2)', dur: '5.9s', delay: '1.8s' },
  { color: 'var(--gt-rose)', dur: '7s', delay: '0.4s' },
  { color: 'var(--gt-mint)', dur: '6.1s', delay: '2.4s' },
  { color: 'var(--gt-accent2)', dur: '5.7s', delay: '1.2s' },
]

const HARP_VELOCITY = 0.5
const HARP_DEBOUNCE = 90 // ms between re-triggers of the same string
const REROLL_MS = 480 // idle after a strum before re-tuning to a new voicing

// A pool of low→high interval stacks (semitones from the root). Each is a lush,
// fully-consonant 6-note voicing; combined with a random root this gives endless
// pretty chords — major, add9, sus2, maj7, minor, min7 — never the same twice.
const ROOTS = ['C2', 'D2', 'E2', 'F2', 'G2', 'A2']
const STACKS = [
  [0, 4, 7, 12, 16, 19], // major
  [0, 4, 7, 12, 14, 19], // add9
  [0, 2, 7, 12, 14, 19], // sus2
  [0, 4, 11, 12, 16, 19], // maj7
  [0, 3, 7, 12, 15, 19], // minor
  [0, 3, 7, 10, 15, 19], // min7
]

/** Build a random lush voicing, ordered top string → bottom string (high → low). */
function randomVoicing() {
  const base = Note.midi(ROOTS[(Math.random() * ROOTS.length) | 0])
  const stack = STACKS[(Math.random() * STACKS.length) | 0]
  return stack.map((o) => Note.fromMidi(base + o)).reverse()
}

const PAD = 10 // vertical padding of the band (matches the old flex layout)
const LINE_H = 2
const N = STRINGS.length

const straight = (w, y) => `M0 ${y} L ${w} ${y}`
// Smooth bow: a quadratic through both fixed ends with the antinode at `cx`.
// Peak displacement is `a` (control offset is 2a so the curve's midpoint hits a).
const bowed = (w, y, a, cx) => `M0 ${y} Q ${cx} ${y + 2 * a} ${w} ${y}`

export default function StringBand() {
  const wrapRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const pathRefs = useRef([])
  const rafRef = useRef(0)
  // Per-string live physics; mutated outside React for smooth per-frame updates.
  const st = useRef(STRINGS.map(() => ({ a: 0, cx: 0, animating: false, A0: 0, t0: 0 })))
  const drag = useRef(null) // { i } while a string is held
  const hoverY = useRef(null) // last hover Y, for harp crossing detection
  const lastTrig = useRef(STRINGS.map(() => 0)) // per-string last-trigger timestamps
  const notesRef = useRef(randomVoicing()) // current string tuning (top → bottom)
  const rerollRef = useRef(0) // idle timer that re-tunes after a strum

  // Re-tune to a fresh voicing once the strum settles (idle for REROLL_MS), so a
  // single sweep stays one coherent chord but the next one is new.
  const scheduleReroll = () => {
    clearTimeout(rerollRef.current)
    rerollRef.current = setTimeout(() => { notesRef.current = randomVoicing() }, REROLL_MS)
  }

  // Measure the band so we can place strings in pixel space.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { w, h } = size
  const innerH = Math.max(0, h - PAD * 2)
  const gap = N > 1 ? (innerH - N * LINE_H) / (N - 1) : 0
  const yOf = (i) => PAD + i * (LINE_H + gap) + LINE_H / 2
  const maxAmp = Math.min(30, gap * 0.9 || 24)

  const applyPath = (i) => {
    const p = pathRefs.current[i]
    if (!p) return
    const s = st.current[i]
    const y = yOf(i)
    p.setAttribute('d', Math.abs(s.a) < 0.15 ? straight(w, y) : bowed(w, y, s.a, s.cx))
  }

  // rAF loop — runs only while at least one string is settling.
  const loop = () => {
    let anyActive = false
    const now = performance.now()
    for (let i = 0; i < N; i++) {
      const s = st.current[i]
      if (!s.animating) continue
      const t = (now - s.t0) / 1000
      const env = Math.exp(-t / 0.34) // amplitude decay
      s.a = s.A0 * env * Math.cos(2 * Math.PI * 5 * t) // damped standing wave
      if (t > 1.5 || Math.abs(s.a) < 0.2) {
        s.a = 0
        s.animating = false
      } else {
        anyActive = true
      }
      applyPath(i)
    }
    rafRef.current = anyActive ? requestAnimationFrame(loop) : 0
  }
  const kick = () => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(loop)
  }

  // Pointer interaction (mouse + touch via Pointer Events).
  const pointFromEvent = (e) => {
    const rect = wrapRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const onDown = (e) => {
    if (!w) return
    const { x, y } = pointFromEvent(e)
    // Grab the nearest string within a comfortable vertical reach.
    let best = -1
    let bestD = (gap + LINE_H) / 2 + 6
    for (let i = 0; i < N; i++) {
      const d = Math.abs(y - yOf(i))
      if (d < bestD) { bestD = d; best = i }
    }
    if (best < 0) return
    drag.current = { i: best }
    const s = st.current[best]
    s.animating = false
    s.cx = Math.max(0, Math.min(w, x))
    s.a = Math.max(-maxAmp, Math.min(maxAmp, y - yOf(best)))
    applyPath(best)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    const { x, y } = pointFromEvent(e)
    const s = st.current[d.i]
    s.cx = Math.max(0, Math.min(w, x))
    s.a = Math.max(-maxAmp, Math.min(maxAmp, y - yOf(d.i)))
    applyPath(d.i)
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    hoverY.current = null // rebaseline harp so the release isn't read as a crossing
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (!d) return
    const s = st.current[d.i]
    s.A0 = s.a
    s.t0 = performance.now()
    s.animating = true
    kick()
    // The string's own note; louder for a bigger pull.
    pluckNote(notesRef.current[d.i], 0.45 + (Math.abs(s.a) / maxAmp) * 0.5)
    scheduleReroll()
  }

  // --- Harp glide: ring a string as the cursor sweeps across it -----------
  const triggerHarp = (i, x) => {
    const now = performance.now()
    if (now - lastTrig.current[i] < HARP_DEBOUNCE) return
    lastTrig.current[i] = now
    pluckNote(notesRef.current[i], HARP_VELOCITY)
    scheduleReroll()
    // A small visual ripple so the crossed string reacts, too.
    const s = st.current[i]
    if (!s.animating || Math.abs(s.a) < 4) {
      s.cx = x
      s.A0 = (Math.random() < 0.5 ? -1 : 1) * 6
      s.t0 = now
      s.animating = true
      kick()
    }
  }
  const onHoverMove = (e) => {
    if (drag.current || !w) return // pressing = pluck mode, handled elsewhere
    const { x, y } = pointFromEvent(e)
    const prev = hoverY.current
    hoverY.current = y
    if (prev == null || prev === y) return
    const cx = Math.max(0, Math.min(w, x))
    for (let i = 0; i < N; i++) {
      const sy = yOf(i)
      // Fire when the pointer's vertical travel straddles this string's line.
      if ((prev - sy) * (y - sy) <= 0) triggerHarp(i, cx)
    }
  }
  const onEnter = (e) => { hoverY.current = pointFromEvent(e).y }
  const onLeave = () => { hoverY.current = null }

  // Keep straight paths correct on resize (when not mid-animation).
  useEffect(() => {
    for (let i = 0; i < N; i++) if (!st.current[i].animating) applyPath(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h])

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    clearTimeout(rerollRef.current)
  }, [])

  return (
    <div ref={wrapRef} className="absolute inset-0">
      {/* Strings — one SVG, overflow visible so a bend can exceed the 2px line. */}
      <svg
        width={w}
        height={h}
        className="absolute inset-0 overflow-visible"
        style={{ touchAction: 'none', cursor: 'grab' }}
        onPointerDown={onDown}
        onPointerMove={onHoverMove}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      >
        <defs>
          {/* userSpaceOnUse so the horizontal fade is well-defined even on a
              zero-height straight line (objectBoundingBox degenerates there). */}
          <linearGradient id="sb-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w} y2="0">
            <stop offset="0" stopColor="var(--gt-border)" stopOpacity="0" />
            <stop offset="0.1" stopColor="var(--gt-border)" stopOpacity="1" />
            <stop offset="0.9" stopColor="var(--gt-border)" stopOpacity="1" />
            <stop offset="1" stopColor="var(--gt-border)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {STRINGS.map((_, i) => (
          <path
            key={i}
            ref={(el) => (pathRefs.current[i] = el)}
            d={straight(w, yOf(i))}
            fill="none"
            stroke="url(#sb-fade)"
            strokeWidth={LINE_H}
          />
        ))}
      </svg>

      {/* Plucking beads — unchanged look/animation, positioned per string. */}
      {STRINGS.map((s, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="gt-anim-pluck absolute pointer-events-none"
          style={{
            top: yOf(i),
            left: 0,
            width: 78,
            height: 9,
            borderRadius: 9,
            background: `radial-gradient(closest-side, ${s.color}, transparent)`,
            animation: `gt-pluck ${s.dur} linear ${s.delay} infinite`,
          }}
        />
      ))}
    </div>
  )
}
