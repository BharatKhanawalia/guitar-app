import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useAudioSync } from '../../context/AudioSyncContext'

/**
 * GridView — the "Yamaha" grid, organised strictly by musical measures.
 *
 * Each cell is one beat; a row holds exactly `meter` beats (4 for 4/4, 3 for 3/4).
 * Chords are labelled only where they CHANGE and held faintly otherwise, so the
 * grid reads like a real chart. A thin cursor sweeps left→right across the active
 * cell, and the grid auto-scrolls row-by-row to keep the current row near the top.
 */
export default function GridView() {
  const {
    beats, meter, activeBeat, beatProgress, seekToBeat,
  } = useAudioSync()

  const scrollRef = useRef(null)
  const activeRowRef = useRef(null)

  const rows = []
  for (let i = 0; i < beats.length; i += meter) rows.push(beats.slice(i, i + meter))
  const activeRow = activeBeat >= 0 ? Math.floor(activeBeat / meter) : -1

  // Auto-scroll row-by-row: keep the active row one row down from the top edge.
  useEffect(() => {
    const box = scrollRef.current
    const row = activeRowRef.current
    if (!box || !row) return
    const target = row.offsetTop - box.offsetTop - row.clientHeight * 1.05
    box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [activeRow])

  if (!beats.length) {
    return (
      <div className="flex flex-col h-full">
        <SettingsBar />
        <div className="grid place-items-center flex-1 text-white/40">No chords detected.</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <SettingsBar />
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto pt-2 pb-4 pr-1">
        <div className="space-y-2">
          {rows.map((row, ri) => {
            const isActiveRow = ri === activeRow
            return (
              <div
                key={ri}
                ref={isActiveRow ? activeRowRef : null}
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${meter}, minmax(0, 1fr))` }}
              >
                {row.map((b, ci) => {
                  const idx = ri * meter + ci
                  const active = idx === activeBeat
                  const past = activeBeat >= 0 && idx < activeBeat
                  return (
                    <button
                      key={ci}
                      onClick={() => seekToBeat(b)}
                      className={`relative h-14 sm:h-16 rounded-xl border overflow-hidden grid place-items-center font-mono transition-colors ${
                        active
                          ? 'border-accent-400 bg-accent-500/20 shadow-glow'
                          : past
                            ? 'border-white/5 bg-white/[0.015]'
                            : 'border-white/10 bg-white/[0.035] hover:bg-white/[0.07]'
                      }`}
                    >
                      {/* sweeping cursor across the active cell */}
                      {active && (
                        <>
                          <div
                            className="absolute inset-y-0 left-0 bg-accent-400/15 pointer-events-none"
                            style={{ width: `${beatProgress * 100}%` }}
                          />
                          <div
                            className="absolute inset-y-0 w-[2px] bg-accent-200 pointer-events-none"
                            style={{ left: `${beatProgress * 100}%`, boxShadow: '0 0 10px rgba(196,181,253,0.9)' }}
                          />
                        </>
                      )}
                      <span
                        className={`relative z-10 font-bold ${
                          b.changed
                            ? active
                              ? 'text-white text-lg sm:text-xl'
                              : past
                                ? 'text-white/40 text-lg sm:text-xl'
                                : 'text-white/90 text-lg sm:text-xl'
                            : active
                              ? 'text-white/70 text-sm'
                              : 'text-white/20 text-sm'
                        }`}
                      >
                        {b.changed ? b.chord : '╌'}
                      </span>
                      <span className="absolute top-1 left-1.5 text-[9px] font-sans text-white/25 z-10">
                        {b.pickup ? '‹' : (idx % meter) + 1}
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Analysis settings bar: Meter · Beat Shift · Key Signature           */
/* ------------------------------------------------------------------ */
function SettingsBar() {
  const {
    meter, setMeter, bpm,
    beatShift, nudgeBeat, resetBeat,
    key, forcedKey, nudgeKey, toggleKeyMode, resetKey,
  } = useAudioSync()

  return (
    <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-white/10 text-xs">
      {/* Meter */}
      <Group label="Meter">
        {[4, 3].map((m) => (
          <button
            key={m}
            onClick={() => setMeter(m)}
            className={`px-2.5 py-1 rounded-lg font-semibold ${
              meter === m ? 'bg-accent-500/80 text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {m}/4
          </button>
        ))}
      </Group>

      {/* Beat shift */}
      <Group label="Beat">
        <MiniBtn onClick={() => nudgeBeat(-0.25)}>−</MiniBtn>
        <button onClick={resetBeat} className="px-2 font-mono tabular-nums text-white/70 min-w-[3rem]" title="Reset">
          {beatShift > 0 ? `+${beatShift}` : beatShift}
        </button>
        <MiniBtn onClick={() => nudgeBeat(0.25)}>+</MiniBtn>
      </Group>

      {/* Key signature */}
      <Group label="Key">
        <MiniBtn onClick={() => nudgeKey(-1)}>−</MiniBtn>
        <span className="px-1.5 font-mono font-bold tabular-nums min-w-[2.6rem] text-center text-accent-300">
          {forcedKey ? forcedKey.label : key ? key.label : 'auto'}
        </span>
        <MiniBtn onClick={() => nudgeKey(1)}>+</MiniBtn>
        <button
          onClick={toggleKeyMode}
          className="px-2 py-1 rounded-lg text-white/60 hover:text-white/90"
          title="Major / Minor"
        >
          {(forcedKey?.mode || key?.mode || 'major') === 'minor' ? 'min' : 'maj'}
        </button>
        <button onClick={resetKey} className="px-2 py-1 rounded-lg text-white/40 hover:text-white/80" title="Reset to auto">
          ↺
        </button>
      </Group>

      <span className="chip !py-0.5 !px-2 text-white/40 ml-auto">{bpm} BPM</span>
    </div>
  )
}

const Group = ({ label, children }) => (
  <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
    <span className="text-[10px] uppercase tracking-wide text-white/35 px-1.5">{label}</span>
    {children}
  </div>
)
const MiniBtn = ({ onClick, children }) => (
  <button onClick={onClick} className="w-6 h-6 grid place-items-center rounded-lg bg-white/5 hover:bg-white/15 font-mono">
    {children}
  </button>
)
