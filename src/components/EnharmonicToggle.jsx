import { motion } from 'framer-motion'

/**
 * EnharmonicToggle — a sleek two-way switch for chord spelling.
 *   ♭ (flats)  ⇄  ♯ (sharps)
 *
 * `flats` is the boolean state (true = prefer flats). `onChange(nextBool)`.
 * A sliding pill (shared layoutId) glides between the two sides. Every chord on
 * screen re-renders through Tonal's enharmonic respelling when this flips.
 */
export default function EnharmonicToggle({ flats, onChange, id = 'enh', className = '' }) {
  const sides = [
    { key: 'flats', symbol: '♭', label: 'Flats', active: flats },
    { key: 'sharps', symbol: '♯', label: 'Sharps', active: !flats },
  ]
  return (
    <div
      role="group"
      aria-label="Note spelling"
      className={`relative inline-flex items-center rounded-full bg-black/30 border border-white/10 p-1 select-none ${className}`}
    >
      {sides.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onChange(s.key === 'flats')}
          aria-pressed={s.active}
          title={`Spell accidentals as ${s.label.toLowerCase()}`}
          className={`relative z-10 flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold transition-colors ${
            s.active ? 'text-white' : 'text-white/45 hover:text-white/70'
          }`}
        >
          {s.active && (
            <motion.span
              layoutId={`enh-pill-${id}`}
              className="absolute inset-0 -z-10 rounded-full bg-accent-500/80 shadow-glow"
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            />
          )}
          <span className="text-base leading-none font-mono">{s.symbol}</span>
          <span className="hidden sm:inline text-xs">{s.label}</span>
        </button>
      ))}
    </div>
  )
}
