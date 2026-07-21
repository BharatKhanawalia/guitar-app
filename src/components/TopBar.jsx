import { useEffect, useState } from 'react'
import MenuButton from './MenuButton'

/**
 * CapoMark — a custom monogram: a capo bar (violet→mint gradient) clamped over
 * three strings. Replaces the old emoji-in-a-chip.
 */
function CapoMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="capomark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.72 0.19 292)" />
          <stop offset="1" stopColor="oklch(0.83 0.14 168)" />
        </linearGradient>
      </defs>
      <g stroke="var(--gt-accent2)" strokeWidth="1.5" strokeLinecap="round" opacity="0.85">
        <line x1="8" y1="6.5" x2="8" y2="23.5" />
        <line x1="14" y1="6.5" x2="14" y2="23.5" />
        <line x1="20" y1="6.5" x2="20" y2="23.5" />
      </g>
      <rect x="4" y="10.4" width="20" height="4.7" rx="2.35" fill="url(#capomark)" />
    </svg>
  )
}

/**
 * Top bar — menu hard-left, centered wordmark, airy right. The bar's frosted
 * backdrop softly fades at its bottom edge (no hard border) and dissolves as
 * you scroll; the wordmark fades with it while the menu button stays put,
 * keeping its own frosted pill so it never gets lost over content.
 */
export default function TopBar({ menuOpen, onToggleMenu, onLogoClick }) {
  const [p, setP] = useState(0) // 0 at top → 1 once scrolled ~140px

  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        setP(Math.min(window.scrollY / 140, 1))
        raf = 0
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // While the overlay is open the bar is always fully present.
  const barOpacity = menuOpen ? 1 : 1 - p
  const logoOpacity = menuOpen ? 1 : Math.max(0, 1 - p * 1.7) // wordmark fades a touch faster

  return (
    <header className="sticky top-0 z-[60] h-16">
      {/* Frosted backdrop — soft bottom edge via mask, dissolves on scroll. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 backdrop-blur-[14px]"
        style={{
          opacity: barOpacity,
          transition: 'opacity 0.12s linear',
          background: 'linear-gradient(to bottom, color-mix(in srgb, var(--gt-bg) 78%, transparent), color-mix(in srgb, var(--gt-bg) 40%, transparent))',
          WebkitMaskImage: 'linear-gradient(to bottom, #000 52%, transparent)',
          maskImage: 'linear-gradient(to bottom, #000 52%, transparent)',
        }}
      />

      <div className="relative h-full flex items-center" style={{ paddingInline: 'clamp(16px, 4vw, 40px)' }}>
        {/* Menu — hard left, always present with its own frosted pill. */}
        <MenuButton open={menuOpen} onToggle={onToggleMenu} />

        {/* Wordmark — centered, fades on scroll. */}
        <button
          onClick={onLogoClick}
          aria-label="Go to home"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 bg-transparent border-0 p-0 cursor-pointer"
          style={{ opacity: logoOpacity, pointerEvents: logoOpacity < 0.06 ? 'none' : 'auto', transition: 'opacity 0.12s linear' }}
        >
          <CapoMark size={26} />
          <span
            className="font-display leading-none"
            style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.035em', color: 'var(--gt-text)' }}
          >
            capo<span className="gt-grad-text">flow</span>
          </span>
        </button>
      </div>
    </header>
  )
}
