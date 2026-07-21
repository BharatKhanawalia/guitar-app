import { useEffect, useRef } from 'react'

/**
 * AmbientParticles — a sparse, slow-floating particle field on its own canvas
 * layer behind the whole app. It sits *above* the gradient Background but below
 * the UI (and below CursorNotes), and never touches the React tree per frame —
 * the entire simulation lives in a single requestAnimationFrame loop drawing to
 * one <canvas>, so it can't cause React re-renders or jank.
 *
 * Physics ("antigravity" cursor repulsion):
 *   • Each particle gently drifts around a slowly-moving home anchor.
 *   • A weak spring keeps it near that home, so the field stays evenly spread.
 *   • When the cursor comes within REPEL_RADIUS, particles accelerate radially
 *     away — carving a cavity around the pointer. When the cursor leaves, the
 *     home-spring eases them back and the cavity refills. Velocity is damped so
 *     motion is smooth, never twitchy.
 *
 * Respects prefers-reduced-motion (renders nothing) and pauses when the tab is
 * hidden. Caps particle count so it stays light on every screen.
 */

const REPEL_RADIUS = 150
const REPEL_FORCE = 2400 // acceleration scale inside the radius
const HOME_SPRING = 0.006 // pull back toward the drifting home
const DAMPING = 0.92 // velocity retention per frame
const MAX_PARTICLES = 36

const NOTE_GLYPHS = ['♪', '♫', '♩']

export default function AmbientParticles() {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    // Pre-render the dot glow ONCE to an offscreen sprite. Blitting this each
    // frame is far cheaper than per-particle shadowBlur or gradient allocation.
    const SPR = 48
    const glowSprite = document.createElement('canvas')
    glowSprite.width = glowSprite.height = SPR
    {
      const g = glowSprite.getContext('2d')
      const grad = g.createRadialGradient(SPR / 2, SPR / 2, 0, SPR / 2, SPR / 2, SPR / 2)
      grad.addColorStop(0, 'rgba(200,186,255,1)')
      grad.addColorStop(0.35, 'rgba(160,140,240,0.55)')
      grad.addColorStop(1, 'rgba(139,92,246,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, SPR, SPR)
    }

    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    let W = 0
    let H = 0
    let particles = []
    let raf = null
    const mouse = { x: -9999, y: -9999, active: false }

    const seed = () => {
      // ~1 particle per 34k px², capped — sparse, never cramped.
      const target = Math.min(MAX_PARTICLES, Math.round((W * H) / 34000))
      particles = Array.from({ length: target }, () => {
        const x = Math.random() * W
        const y = Math.random() * H
        const isNote = Math.random() < 0.28
        return {
          x,
          y,
          hx: x, // home anchor
          hy: y,
          vx: 0,
          vy: 0,
          // very slow home drift
          dvx: (Math.random() - 0.5) * 6,
          dvy: (Math.random() - 0.5) * 6,
          r: isNote ? 8 + Math.random() * 5 : 1 + Math.random() * 1.8,
          alpha: 0.18 + Math.random() * 0.35,
          isNote,
          glyph: NOTE_GLYPHS[(Math.random() * NOTE_GLYPHS.length) | 0],
        }
      })
    }

    const resize = () => {
      W = window.innerWidth
      H = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = W + 'px'
      canvas.style.height = H + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
    }

    let last = performance.now()
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000) // clamp big gaps (tab wake)
      last = now
      ctx.clearRect(0, 0, W, H)

      for (const p of particles) {
        // Drift the home anchor slowly, wrapping around the screen.
        p.hx += p.dvx * dt
        p.hy += p.dvy * dt
        if (p.hx < -20) p.hx = W + 20
        else if (p.hx > W + 20) p.hx = -20
        if (p.hy < -20) p.hy = H + 20
        else if (p.hy > H + 20) p.hy = -20

        // Home spring.
        p.vx += (p.hx - p.x) * HOME_SPRING
        p.vy += (p.hy - p.y) * HOME_SPRING

        // Cursor repulsion (antigravity cavity).
        if (mouse.active) {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const d2 = dx * dx + dy * dy
          if (d2 < REPEL_RADIUS * REPEL_RADIUS) {
            const d = Math.sqrt(d2) || 0.0001
            const falloff = 1 - d / REPEL_RADIUS // 1 at cursor → 0 at edge
            const a = (REPEL_FORCE * falloff * falloff) / d
            p.vx += (dx / d) * a * dt
            p.vy += (dy / d) * a * dt
          }
        }

        p.vx *= DAMPING
        p.vy *= DAMPING
        p.x += p.vx * dt
        p.y += p.vy * dt

        // Draw.
        if (p.isNote) {
          ctx.font = `${p.r * 2}px "JetBrains Mono", monospace`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = `rgba(196,181,253,${p.alpha * 0.75})`
          ctx.fillText(p.glyph, p.x, p.y)
        } else {
          // Blit the pre-rendered glow sprite, sized/faded per particle.
          const s = p.r * 6
          ctx.globalAlpha = p.alpha
          ctx.drawImage(glowSprite, p.x - s / 2, p.y - s / 2, s, s)
          ctx.globalAlpha = 1
        }
      }

      raf = requestAnimationFrame(tick)
    }

    const onMove = (e) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
      mouse.active = true
    }
    const onLeave = () => {
      mouse.active = false
      mouse.x = mouse.y = -9999
    }
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = null
      } else if (!raf) {
        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
    }

    resize()
    raf = requestAnimationFrame(tick)
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mouseout', onLeave)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-[1]"
    />
  )
}
