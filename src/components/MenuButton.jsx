/**
 * MENU button — a 42px rounded square holding four "breathing" equalizer bars
 * that morph into an ✕ when the overlay menu is open. Rendered on every page.
 * Colours + timings mirror the Fretwork prototype.
 */

const BARS = [
  { h: 11, color: 'var(--gt-accent2)', delay: '0s' },
  { h: 17, color: 'var(--gt-mint)', delay: '0.18s' },
  { h: 8, color: 'var(--gt-rose)', delay: '0.36s' },
  { h: 14, color: 'var(--gt-accent2)', delay: '0.54s' },
]

export default function MenuButton({ open, onToggle }) {
  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <button
        onClick={onToggle}
        aria-label="Menu"
        aria-expanded={open}
        className="relative w-[42px] h-[42px] rounded-[13px] flex items-center justify-center gap-[3.5px] transition-all duration-200 gt-menu-btn backdrop-blur-xl"
        style={{
          border: '1px solid var(--gt-border)',
          background: 'color-mix(in srgb, var(--gt-panel) 78%, transparent)',
        }}
      >
        {open ? (
          <>
            <span
              className="absolute rounded-[3px]"
              style={{ width: 19, height: 2.5, background: 'var(--gt-text)', transform: 'rotate(45deg)' }}
            />
            <span
              className="absolute rounded-[3px]"
              style={{ width: 19, height: 2.5, background: 'var(--gt-text)', transform: 'rotate(-45deg)' }}
            />
          </>
        ) : (
          BARS.map((b, i) => (
            <span
              key={i}
              className="gt-eqbar"
              style={{ height: b.h, background: b.color, animationDelay: b.delay }}
            />
          ))
        )}
      </button>
      <span
        className="font-mono font-semibold"
        style={{ fontSize: '7.5px', letterSpacing: '0.22em', color: 'var(--gt-muted)' }}
      >
        MENU
      </span>
    </div>
  )
}
