import { useEffect } from 'react'

/**
 * Glow cursor from the Fretwork handoff — a large soft radial that trails the
 * pointer. Appended imperatively to <body> so it sits above the ambient layers
 * but never intercepts clicks. Disabled on touch/coarse pointers and when the
 * user prefers reduced motion. Runs alongside the existing note-trail cursor.
 */
export default function GlowCursor() {
  useEffect(() => {
    const coarse = window.matchMedia('(hover: none)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (coarse || reduced) return

    const el = document.createElement('div')
    el.className = 'gt-glow-cursor'
    el.style.opacity = '0'
    document.body.appendChild(el)

    let raf = 0
    const move = (e) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        el.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`
        el.style.opacity = '1'
        raf = 0
      })
    }
    const leave = () => {
      el.style.opacity = '0'
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerdown', move)
    document.addEventListener('mouseleave', leave)

    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', move)
      document.removeEventListener('mouseleave', leave)
      if (raf) cancelAnimationFrame(raf)
      el.remove()
    }
  }, [])

  return null
}
