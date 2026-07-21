import { useEffect } from 'react'
import ModuleIcon from './NavIcons'

/**
 * Full-screen overlay menu from the Fretwork handoff. Fades in/out, locks page
 * scroll while open, closes on ✕ / Esc / item pick. Menu labels use Bricolage
 * Grotesque (per the project's font choice, in place of the prototype serif).
 */

const ITEMS = [
  { id: 'home', label: 'Home' },
  { id: 'capo', label: 'Capo Calculator' },
  { id: 'sheet', label: 'Sheet Transposer' },
  { id: 'strum', label: 'Strumming Studio' },
  { id: 'tuner', label: 'Guitar Tuner' },
  { id: 'ar', label: 'Magic Chords', badge: 'FLAGSHIP', badgeColor: 'var(--gt-accent)', badgeBg: 'var(--gt-accent-soft)' },
  { id: 'audio', label: 'Audio → Chords', badge: 'SOON', badgeColor: 'var(--gt-amber)', badgeBg: 'color-mix(in srgb, var(--gt-amber) 16%, transparent)' },
]

export default function MenuOverlay({ open, current, onNavigate, onClose }) {
  // Esc to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <div
      className="fixed inset-0 z-[55]"
      style={{
        background: 'var(--gt-bg)',
        transition: 'opacity 0.32s ease, visibility 0.32s ease',
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        pointerEvents: open ? 'auto' : 'none',
      }}
      aria-hidden={!open}
    >
      {/* Accent wash + dot grid */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(52vw 52vw at 82% 22%, var(--gt-accent-soft), transparent 62%), radial-gradient(42vw 42vw at 10% 92%, oklch(0.62 0.14 210 / 0.12), transparent 60%)',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.4,
          backgroundImage: 'radial-gradient(var(--gt-border) 0.5px, transparent 0.5px)',
          backgroundSize: '22px 22px',
        }}
      />

      <div
        className="gt-noscroll relative h-full overflow-y-auto flex flex-col"
        style={{ maxWidth: 1040, padding: 'clamp(96px,13vh,150px) clamp(20px,5vw,56px) 48px' }}
      >
        <nav className="flex flex-col">
          {ITEMS.map((item, i) => {
            const active = current === item.id
            const last = i === ITEMS.length - 1
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="gt-ico-host gt-mi flex items-center bg-transparent border-0 cursor-pointer text-left"
                style={{
                  gap: 'clamp(16px,2.4vw,30px)',
                  width: '100%',
                  padding: 'clamp(9px,1.3vw,17px) 8px',
                  borderBottom: last ? 'none' : '1px solid color-mix(in srgb, var(--gt-border) 55%, transparent)',
                  color: active ? 'var(--gt-accent)' : 'var(--gt-muted)',
                  animation: open ? `gt-itemin 0.5s cubic-bezier(0.16,0.84,0.44,1) both` : 'none',
                  animationDelay: `${0.06 + i * 0.06}s`,
                }}
              >
                <span className="gt-mi-ic shrink-0 flex" style={{ transition: 'color 0.2s' }}>
                  <ModuleIcon id={item.id} size={34} />
                </span>
                <span
                  className="gt-mi-label font-display"
                  style={{
                    fontWeight: 600,
                    fontSize: 'clamp(30px,5.2vw,60px)',
                    letterSpacing: '-0.03em',
                    lineHeight: 1,
                    color: active ? 'var(--gt-accent)' : 'var(--gt-text)',
                  }}
                >
                  {item.label}
                </span>
                {item.badge && (
                  <span
                    className="font-mono self-center"
                    style={{
                      fontSize: 9,
                      padding: '4px 9px',
                      borderRadius: 20,
                      background: item.badgeBg,
                      color: item.badgeColor,
                      letterSpacing: '0.08em',
                      fontWeight: 600,
                      marginLeft: 2,
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div
          className="flex items-center gap-4 flex-wrap"
          style={{ marginTop: 'clamp(22px,4vw,44px)' }}
        >
          <span className="flex items-center gap-2" style={{ fontSize: 12.5, color: 'var(--gt-muted)' }}>
            <span
              style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gt-mint)', boxShadow: '0 0 8px var(--gt-mint)' }}
            />
            100% on-device · zero latency · no accounts
          </span>
        </div>
      </div>
    </div>
  )
}
