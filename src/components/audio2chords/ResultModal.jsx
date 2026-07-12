import { useState } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { AudioSyncProvider, useAudioSync } from '../../context/AudioSyncContext'
import GridView from './GridView'
import LyricsView from './LyricsView'
import PlaybackBar from './PlaybackBar'

/**
 * ResultModal — the "magic" dialog: blurred backdrop, two tabs (Grid / Lyrics)
 * over a shared transport, all inside one AudioSyncProvider so playback stays in
 * sync. AnimatePresence wraps a SINGLE motion root so the backdrop always
 * exit-animates and unmounts cleanly (no invisible overlay left intercepting
 * clicks after close).
 */
export default function ResultModal({ open, onClose, result, audioBytes, preferFlats, title }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="a2c-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, pointerEvents: 'none' }}
          className="fixed inset-0 z-40"
        >
          <AudioSyncProvider result={result} audioBytes={audioBytes} preferFlats={preferFlats}>
            <ModalInner onClose={onClose} title={title} />
          </AudioSyncProvider>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const TABS = [
  { id: 'grid', label: 'Grid View', icon: '▦' },
  { id: 'lyrics', label: 'Lyrics + Chords', icon: '🎤' },
]

function ModalInner({ onClose, title }) {
  const [tab, setTab] = useState('grid')
  const [lyricsText, setLyricsText] = useState('')
  const { ready, key, forcedKey, engine, semitones, segments, bpm } = useAudioSync()

  const meta = { key: forcedKey ? forcedKey.label : key ? key.label : undefined, bpm }

  return (
    <>
      <div onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-md" />

      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 24 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="absolute inset-2 sm:inset-4 md:inset-8 flex flex-col glass !rounded-3xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-white/10">
          <div className="min-w-0">
            <h2 className="font-extrabold text-lg sm:text-xl truncate flex items-center gap-2">
              {title || 'Detected Chords'}
              {ready && <span className="text-mint-400 text-sm">✓</span>}
            </h2>
            <div className="flex items-center gap-2 text-xs text-white/50 mt-0.5 flex-wrap">
              {(forcedKey || (key && key.confidence > 0.45)) && (
                <span className="chip !py-0.5 !px-2 text-mint-400">
                  Key {forcedKey ? forcedKey.label : key.label}
                  {forcedKey && <span className="text-white/40 ml-1">forced</span>}
                </span>
              )}
              <span className="chip !py-0.5 !px-2">{segments.length} chords</span>
              <span className="chip !py-0.5 !px-2 text-white/40">Traditional engine</span>
              {semitones !== 0 && (
                <span className="chip !py-0.5 !px-2 text-accent-400">
                  transposed {semitones > 0 ? `+${semitones}` : semitones}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost !p-2.5 !rounded-full shrink-0" title="Close">
            ✕
          </button>
        </div>

        {/* Tab switch */}
        <LayoutGroup>
          <div className="px-5 sm:px-6 pt-3">
            <div className="glass-soft p-1 inline-flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                    tab === t.id ? 'text-white' : 'text-white/50 hover:text-white/80'
                  }`}
                >
                  {tab === t.id && (
                    <motion.span
                      layoutId="a2c-tab-pill"
                      className="absolute inset-0 bg-accent-500/80 rounded-xl -z-10"
                      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                    />
                  )}
                  <span className="mr-1.5">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </LayoutGroup>

        {/* Body */}
        <div className="flex-1 min-h-0 px-4 sm:px-6 py-4">
          {!ready ? (
            <div className="h-full grid place-items-center text-white/50">
              <div className="text-center">
                <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-accent-400 border-t-transparent animate-spin" />
                Preparing playback…
              </div>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, x: tab === 'grid' ? -12 : 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: tab === 'grid' ? 12 : -12 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                {tab === 'grid' ? (
                  <GridView />
                ) : (
                  <LyricsView lyricsText={lyricsText} onLyricsChange={setLyricsText} />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {ready && (
          <PlaybackBar
            showExport={tab === 'lyrics'}
            lyricsText={lyricsText}
            title={title || 'CapoFlow Chord Sheet'}
            meta={meta}
          />
        )}
      </motion.div>
    </>
  )
}
