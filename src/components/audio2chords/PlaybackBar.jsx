import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAudioSync } from '../../context/AudioSyncContext'
import { buildSheet } from '../../lib/sheet'
import { rangeFill } from '../../lib/ui'
import { exportPDF, exportDOCX } from '../../lib/exporters'

/**
 * PlaybackBar — the shared bottom transport.
 *   Row 1: timeline seeker with a floating timestamp tooltip.
 *   Row 2: Transpose (far left) · Play/Prev/Next (dead center) ·
 *          Tempo + Volume + Melody-Suppressor + Export (right).
 */
export default function PlaybackBar({ showExport, lyricsText, title, meta }) {
  const {
    playing, time, duration, rate, semitones, volume, suppress, scaledDuration,
    segments, togglePlay, seek, setRate, shiftPitch, setVolume, toggleSuppress, next, prev,
  } = useAudioSync()

  const barRef = useRef(null)
  const [scrub, setScrub] = useState(null)
  const [dragging, setDragging] = useState(false)
  const pct = duration ? (time / duration) * 100 : 0

  const xToTime = (clientX) => {
    const rect = barRef.current.getBoundingClientRect()
    const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return r * duration
  }
  const onMove = (e) => {
    if (!barRef.current) return
    const rect = barRef.current.getBoundingClientRect()
    const t = xToTime(e.clientX)
    setScrub({ x: e.clientX - rect.left, t })
    if (dragging) seek(t)
  }

  return (
    <div className="border-t border-white/10 bg-black/40 backdrop-blur-xl px-4 sm:px-6 py-3">
      {/* Seeker */}
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono text-xs text-white/50 w-12 text-right tabular-nums">
          {fmt(time / rate)}
        </span>
        <div
          ref={barRef}
          className="relative flex-1 h-6 flex items-center cursor-pointer"
          onMouseMove={onMove}
          onMouseLeave={() => !dragging && setScrub(null)}
          onMouseDown={(e) => {
            setDragging(true)
            seek(xToTime(e.clientX))
            const up = () => {
              setDragging(false)
              window.removeEventListener('mouseup', up)
            }
            window.addEventListener('mouseup', up)
          }}
        >
          <div className="absolute inset-x-0 h-1.5 rounded-full bg-white/10 overflow-hidden">
            {segments.map((s, i) =>
              i === 0 ? null : (
                <span
                  key={i}
                  className="absolute top-0 h-full w-px bg-white/20"
                  style={{ left: `${(s.start / duration) * 100}%` }}
                />
              ),
            )}
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent-500 to-mint-400"
              style={{ width: `${pct}%` }}
            />
          </div>
          <motion.div
            className="absolute w-4 h-4 rounded-full bg-white shadow-glow border-2 border-accent-500 -ml-2 pointer-events-none"
            style={{ left: `${pct}%` }}
            animate={{ scale: dragging ? 1.3 : 1 }}
          />
          <AnimatePresence>
            {scrub && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute -top-8 -translate-x-1/2 px-2 py-1 rounded-lg bg-accent-500 text-white text-xs font-mono shadow-glow pointer-events-none whitespace-nowrap"
                style={{ left: scrub.x }}
              >
                {fmt(scrub.t / rate)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <span className="font-mono text-xs text-white/50 w-12 tabular-nums">{fmt(scaledDuration)}</span>
      </div>

      {/* Controls: Transpose (left) · Transport (center) · Tempo/Vol/Suppress/Export (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 items-center gap-3">
        {/* TRANSPOSE — left */}
        <div className="flex items-center gap-2 justify-center lg:justify-start order-2 lg:order-1">
          <span className="text-[11px] uppercase tracking-widest text-white/40">Transpose</span>
          <button onClick={() => shiftPitch(-1)} className="btn-ghost !px-3 !py-2 font-mono">−</button>
          <span className="font-mono text-sm w-9 text-center tabular-nums">
            {semitones > 0 ? `+${semitones}` : semitones}
          </span>
          <button onClick={() => shiftPitch(1)} className="btn-ghost !px-3 !py-2 font-mono">+</button>
        </div>

        {/* TRANSPORT — dead center */}
        <div className="flex items-center gap-3 justify-center order-1 lg:order-2">
          <button onClick={prev} className="btn-ghost !px-3 !py-2" title="Previous chord">⏮</button>
          <motion.button
            onClick={togglePlay}
            whileTap={{ scale: 0.9 }}
            className="btn-primary !rounded-full w-14 h-14 !p-0 text-2xl"
          >
            {playing ? '❚❚' : '▶'}
          </motion.button>
          <button onClick={next} className="btn-ghost !px-3 !py-2" title="Next chord">⏭</button>
        </div>

        {/* TEMPO / VOLUME / SUPPRESS / EXPORT — right */}
        <div className="flex items-center gap-3 justify-center lg:justify-end order-3 flex-wrap min-w-0">
          <label className="flex items-center gap-1.5" title="Speed (pitch preserved)">
            <span className="text-[11px] uppercase tracking-widest text-white/40 shrink-0">Tempo</span>
            <input
              type="range" min={0.25} max={3} step={0.05} value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              style={rangeFill(rate, 0.25, 3)}
              className="w-20 sm:w-24"
            />
            <span className="font-mono text-xs w-11 text-right tabular-nums shrink-0">{rate.toFixed(2)}×</span>
          </label>

          <label className="flex items-center gap-1.5" title="Volume">
            <span className="text-white/40 text-sm">🔊</span>
            <input
              type="range" min={0} max={1.5} step={0.02} value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              style={rangeFill(volume, 0, 1.5)}
              className="w-16 sm:w-20"
            />
          </label>

          <button
            onClick={toggleSuppress}
            title="Suppress centre-panned vocals/melody"
            className={`chip text-xs ${
              suppress ? 'bg-mint-400/20 border-mint-400/50 text-mint-300' : 'text-white/55'
            }`}
          >
            🎙️ {suppress ? 'Vocals off' : 'Vocals'}
          </button>

          {showExport && (
            <ExportMenu lyricsText={lyricsText} title={title} meta={meta} segments={segments} />
          )}
        </div>
      </div>
    </div>
  )
}

function ExportMenu({ lyricsText, title, meta, segments }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (fn) => {
    setBusy(true)
    setOpen(false)
    try {
      await fn(title, buildSheet(segments, lyricsText), meta)
    } catch (e) {
      console.error(e)
      alert('Export failed — see console.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} disabled={busy} className="btn-ghost !py-2">
        {busy ? 'Exporting…' : '⬇ Export'}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              className="absolute bottom-full right-0 mb-2 z-20 glass p-1.5 w-40"
            >
              <button onClick={() => run(exportPDF)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 text-sm">
                📄 PDF (.pdf)
              </button>
              <button onClick={() => run(exportDOCX)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 text-sm">
                📝 Word (.docx)
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

const fmt = (s) => {
  if (!isFinite(s)) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
