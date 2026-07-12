import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAudioSync } from '../../context/AudioSyncContext'
import { buildSheet } from '../../lib/sheet'

/**
 * LyricsView — the "Ultimate" tab.
 *
 * Empty state: a big, centred textarea + "Sync Lyrics" button. Paste raw lyrics
 * (straight from Ultimate Guitar), hit sync, and the detected chords are
 * distributed above the lines to recreate that classic chord-sheet look.
 *
 * Playing state: the chord currently sounding triggers the "wave" — it scales to
 * ~1.25×, blooms to a vibrant highlight, and eases back down as playback moves on.
 */
export default function LyricsView({ lyricsText, onLyricsChange }) {
  const { segments, activeIndex, jumpTo } = useAudioSync()
  const [draft, setDraft] = useState(lyricsText)
  const [editing, setEditing] = useState(false)
  const activeRef = useRef(null)

  const lines = useMemo(() => buildSheet(segments, lyricsText), [segments, lyricsText])
  const synced = !!lyricsText.trim()

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIndex])

  if (!segments.length) {
    return <div className="grid place-items-center h-full text-white/40">No chords detected.</div>
  }

  // --- Empty / editing state: the paste-and-sync composer. ---
  if (!synced || editing) {
    return (
      <div className="h-full grid place-items-center px-2">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="glass-soft w-full max-w-2xl p-6 sm:p-8 text-center"
        >
          <div className="text-4xl mb-3">🎤</div>
          <h3 className="font-bold text-lg mb-1">Sync your lyrics</h3>
          <p className="text-sm text-white/50 mb-5 max-w-md mx-auto">
            Paste the raw lyrics (e.g. copied from Ultimate Guitar). CapoFlow will
            float the {segments.length} detected chords above the words and light
            them up in time with the music.
          </p>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              'Is this the real life?\nIs this just fantasy?\nCaught in a landslide,\nNo escape from reality…'
            }
            rows={9}
            className="w-full bg-black/40 border border-white/10 focus:border-accent-400/60 rounded-2xl px-4 py-3 text-sm outline-none resize-y font-mono leading-relaxed"
          />
          <div className="flex items-center justify-center gap-3 mt-5">
            {synced && (
              <button onClick={() => setEditing(false)} className="btn-ghost">
                Cancel
              </button>
            )}
            <motion.button
              whileTap={{ scale: 0.95 }}
              disabled={!draft.trim()}
              onClick={() => {
                onLyricsChange(draft)
                setEditing(false)
              }}
              className="btn-primary disabled:opacity-40"
            >
              ✨ Sync Lyrics
            </motion.button>
          </div>
        </motion.div>
      </div>
    )
  }

  // --- Synced state: chords floating above the lyric lines, with the wave. ---
  return (
    <div className="h-full overflow-y-auto px-1">
      <div className="flex justify-end mb-3">
        <button
          onClick={() => {
            setDraft(lyricsText)
            setEditing(true)
          }}
          className="chip text-white/60 hover:text-white text-xs"
        >
          ✎ Edit lyrics
        </button>
      </div>

      <div className="space-y-5 pb-6 font-mono leading-relaxed">
        {lines.map((line, li) => {
          const hasActive = line.chords.some((c) => c.index === activeIndex)
          return (
            <div key={li} ref={hasActive ? activeRef : null} className="min-h-[1.5rem]">
              {line.chords.length > 0 && (
                <div className="relative h-9">
                  {line.chords.map((c) => {
                    const active = c.index === activeIndex
                    return (
                      <motion.button
                        key={c.index}
                        onClick={() => jumpTo(c.index)}
                        className="absolute top-0 origin-bottom font-bold"
                        style={{ left: `${c.col}ch` }}
                        animate={{
                          scale: active ? 1.25 : 1,
                          y: active ? -2 : 0,
                          color: active ? '#c4b5fd' : 'rgba(255,255,255,0.55)',
                          textShadow: active
                            ? '0 0 18px rgba(139,92,246,0.85)'
                            : '0 0 0px rgba(0,0,0,0)',
                        }}
                        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                      >
                        {c.chord}
                      </motion.button>
                    )
                  })}
                </div>
              )}
              <div className={line.text ? 'text-white/85 whitespace-pre-wrap' : 'h-2'}>
                {line.text}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
