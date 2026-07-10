import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * CursorNotes — a lightweight, performant music-note trail that follows the
 * cursor over empty space. Notes spawn as the mouse moves, drift with a little
 * physics and fade out. When the pointer slows or circles, notes cluster and
 * grow slightly (spring-driven) instead of streaking away.
 *
 * Design constraints for performance:
 *   • Spawns are throttled by BOTH time and distance moved.
 *   • Hard cap on concurrent notes; oldest are dropped.
 *   • Only transform/opacity animate (GPU compositable), pointer-events: none.
 *   • Fully disabled when the OS requests reduced motion.
 */

const GLYPHS = ['🎵', '🎶', '♩', '♪', '♫']
const MAX_NOTES = 18
const SPAWN_MS = 85 // min time between spawns
const MOVE_MIN = 14 // min px moved between spawns

let uid = 0

export default function CursorNotes() {
  const [notes, setNotes] = useState([])
  const last = useRef({ x: 0, y: 0, t: 0 })
  const speedRef = useRef(0)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || window.matchMedia('(hover: none)').matches) return

    const onMove = (e) => {
      const now = performance.now()
      const { x, y, t } = last.current
      const dx = e.clientX - x
      const dy = e.clientY - y
      const dist = Math.hypot(dx, dy)
      const dt = now - t

      // Track a smoothed speed so we can detect "resting / circling".
      if (dt > 0) speedRef.current = speedRef.current * 0.8 + (dist / dt) * 0.2

      if (dt < SPAWN_MS || dist < MOVE_MIN) return
      last.current = { x: e.clientX, y: e.clientY, t: now }

      // Slow pointer → cluster: bigger, lingering notes with little drift.
      const slow = speedRef.current < 0.35
      const drift = slow ? 12 : 42

      const note = {
        id: uid++,
        x: e.clientX + (Math.random() - 0.5) * 10,
        y: e.clientY + (Math.random() - 0.5) * 10,
        dx: (Math.random() - 0.5) * drift - (slow ? 0 : dx * 0.15),
        dy: -20 - Math.random() * drift,
        glyph: GLYPHS[(Math.random() * GLYPHS.length) | 0],
        size: slow ? 22 + Math.random() * 12 : 13 + Math.random() * 8,
        rot: (Math.random() - 0.5) * 40,
        life: slow ? 1.6 : 1.1,
      }

      setNotes((prev) => {
        const next = [...prev, note]
        return next.length > MAX_NOTES ? next.slice(next.length - MAX_NOTES) : next
      })
      // Self-cleanup after its lifetime.
      setTimeout(() => {
        setNotes((prev) => prev.filter((n) => n.id !== note.id))
      }, note.life * 1000 + 60)
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">
      <AnimatePresence>
        {notes.map((n) => (
          <motion.span
            key={n.id}
            initial={{ opacity: 0, scale: 0.4, x: n.x, y: n.y, rotate: 0 }}
            animate={{
              opacity: [0, 0.9, 0],
              scale: [0.4, 1, 0.85],
              x: n.x + n.dx,
              y: n.y + n.dy,
              rotate: n.rot,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: n.life, ease: 'easeOut' }}
            className="absolute left-0 top-0 select-none will-change-transform"
            style={{
              fontSize: n.size,
              color: 'rgba(196,181,253,0.9)',
              textShadow: '0 0 10px rgba(139,92,246,0.5)',
              marginLeft: -n.size / 2,
              marginTop: -n.size / 2,
            }}
          >
            {n.glyph}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  )
}
