import { useState, useMemo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { parseChordSheet } from '../lib/parser'
import { transposeChord, simplifyChord, isChord, detectKey } from '../lib/chordTheory'
import { playChord } from '../lib/audioEngine'
import useKeyboardTranspose from '../hooks/useKeyboardTranspose'
import EnharmonicToggle from './EnharmonicToggle'
import { useStore } from '../store.jsx'
import { rangeFill } from '../lib/ui'

// Below this confidence, we hide the key badge rather than assert bad theory.
const KEY_CONFIDENCE_MIN = 0.5

/**
 * A sleek glassmorphism Edit toggle that lives *inside* the sheet/paper it edits.
 * Semi-transparent by default, fully opaque on hover — obviously acts on the
 * sheet you're looking at.
 */
function EditToggle({ editing, onClick }) {
  return (
    <button
      onClick={onClick}
      title={editing ? 'Done editing' : 'Edit this sheet'}
      className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5
                 text-sm font-semibold text-white/70 hover:text-white
                 bg-white/[0.06] hover:bg-white/20 backdrop-blur-md
                 border border-white/15 hover:border-white/40
                 opacity-60 hover:opacity-100 shadow-lg transition-all active:scale-95"
    >
      {editing ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Done
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          Edit
        </>
      )}
    </button>
  )
}

function InteractiveChord({ symbol }) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.button
        key={symbol}
        initial={{ y: -6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 6, opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={() => playChord(symbol)}
        className="text-accent-400 font-bold hover:text-mint-400 transition-colors cursor-pointer"
      >
        {symbol}
      </motion.button>
    </AnimatePresence>
  )
}

export default function SheetTransposer() {
  // Cross-tab state lives in the global store so it survives tab switches.
  const {
    sheet: raw,
    setSheet: setRaw,
    semitones,
    setSemitones,
    simplify,
    setSimplify,
    preferFlats,
    setPreferFlats,
  } = useStore()
  const [editing, setEditing] = useState(false)
  const [showTips, setShowTips] = useState(true) // collapse the guide + capo note to free space

  // Autoscroll
  const [scrolling, setScrolling] = useState(false)
  const [speed, setSpeed] = useState(40) // 0–100 (exponential → px/s)
  const sheetRef = useRef(null)
  const rafRef = useRef(null)
  const accRef = useRef(0)

  const model = useMemo(() => parseChordSheet(raw), [raw])

  const renderChord = (chord) => {
    if (!chord || !isChord(chord)) return chord
    let out = transposeChord(chord, semitones, preferFlats)
    if (simplify) out = simplifyChord(out)
    return out
  }

  const allChords = useMemo(() => {
    const set = new Set()
    model.lines.forEach((l) =>
      l.pairs.forEach((p) => p.chord && isChord(p.chord) && set.add(renderChord(p.chord))),
    )
    return [...set]
  }, [model, semitones, simplify, preferFlats])

  const key = useMemo(() => detectKey(allChords), [allChords])

  useKeyboardTranspose({
    onUp: () => setSemitones((s) => Math.min(11, s + 1)),
    onDown: () => setSemitones((s) => Math.max(-11, s - 1)),
    onReset: () => setSemitones(0),
  })

  // Smooth autoscroll loop (sub-pixel accumulation for buttery motion).
  useEffect(() => {
    if (!scrolling) {
      cancelAnimationFrame(rafRef.current)
      return
    }
    let last = performance.now()
    const step = (now) => {
      const dt = (now - last) / 1000
      last = now
      const el = sheetRef.current
      if (el) {
        // Exponential mapping: the slider (0–100) maps to ~1.5 → 120 px/s. Most of
        // the travel now lives at the SLOW end so you can crawl with the lyrics.
        const px = 1.5 * Math.pow(80, speed / 100)
        accRef.current += px * dt
        const whole = Math.floor(accRef.current)
        if (whole >= 1) {
          el.scrollTop += whole
          accRef.current -= whole
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
            setScrolling(false)
            return
          }
        }
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [scrolling, speed])

  const semitoneLabel = semitones > 0 ? `+${semitones}` : `${semitones}`

  return (
    <div className="space-y-4">
      {/* Tips toggle — collapse the guide + capo note so the sheet isn't pushed down */}
      <div className="flex justify-end -mb-1">
        <button
          onClick={() => setShowTips((s) => !s)}
          className="chip text-xs text-white/60 hover:text-white"
        >
          {showTips ? '▴ Hide tips' : '▾ Show tips & capo help'}
        </button>
      </div>

      {/* How-to guide */}
      {showTips && (
      <div className="glass-soft p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🎼</span>
          <h3 className="font-bold text-sm">Paste any song in seconds</h3>
        </div>
        <ol className="grid sm:grid-cols-2 gap-2.5 text-[13px]">
          {[
            <>Search <span className="text-accent-300 font-semibold">“&lt;song name&gt; guitar chords”</span> on Google.</>,
            <>Open the <span className="text-accent-300 font-semibold">tabs.ultimate-guitar.com</span> link and copy the text sheet.</>,
            <>Click <span className="text-mint-300 font-semibold">Edit</span> below, paste the text, and click <span className="text-mint-300 font-semibold">Done</span>.</>,
            <>Use <span className="text-accent-300 font-semibold">Transpose</span> to find easier chords, and check <span className="text-accent-300 font-semibold">Simplify</span> to drop complex extensions.</>,
          ].map((t, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-accent-500/80 grid place-items-center text-[10px] font-bold">
                {i + 1}
              </span>
              <span className="text-white/75">{t}</span>
            </li>
          ))}
        </ol>
      </div>
      )}

      {showTips && <CapoTransposeNote semitones={semitones} />}

      {/* Control bar */}
      <div className="glass p-4 flex flex-wrap items-center gap-3 sticky top-2 z-20">
        {/* Transpose */}
        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
          <button
            onClick={() => setSemitones((s) => Math.max(-11, s - 1))}
            className="btn-ghost !px-3 !py-1.5 !rounded-lg"
            aria-label="Transpose down"
          >
            −
          </button>
          <button
            onClick={() => setSemitones(0)}
            className="min-w-[3.5rem] text-center font-mono font-bold tabular-nums"
            title="Reset (press 0)"
          >
            {semitoneLabel}
          </button>
          <button
            onClick={() => setSemitones((s) => Math.min(11, s + 1))}
            className="btn-primary !px-3 !py-1.5 !rounded-lg"
            aria-label="Transpose up"
          >
            +
          </button>
        </div>

        {key && key.confidence >= KEY_CONFIDENCE_MIN && (
          <span
            className="chip text-white/70"
            title={`Estimated key · ${Math.round(key.confidence * 100)}% confidence`}
          >
            Key <span className="font-mono font-bold text-accent-400 ml-1">{key.label}</span>
          </span>
        )}

        <label className="chip cursor-pointer select-none">
          <input
            type="checkbox"
            checked={simplify}
            onChange={(e) => setSimplify(e.target.checked)}
            className="accent-accent-500"
          />
          Simplify
        </label>

        <EnharmonicToggle flats={preferFlats} onChange={setPreferFlats} id="sheet" />

        <button
          onClick={() => setScrolling((s) => !s)}
          className={`chip ${scrolling ? 'bg-mint-400/20 border-mint-400/50 text-mint-400' : ''}`}
        >
          {scrolling ? '❚❚ Scrolling' : '⤓ Autoscroll'}
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-[140px]">
          <span className="text-xs text-white/40">Speed</span>
          <input
            type="range"
            min="0"
            max="100"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            style={rangeFill(speed, 0, 100)}
            className="flex-1"
          />
        </div>
      </div>

      {/* Editor / Sheet */}
      <AnimatePresence mode="wait">
        {editing ? (
          <motion.div
            key="editor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass p-4 relative"
          >
            <EditToggle editing onClick={() => setEditing(false)} />
            <p className="text-xs text-white/40 mb-2 pr-20">
              Paste an Ultimate-Guitar style sheet (chords on their own line, above the lyrics).
            </p>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              spellCheck={false}
              className="w-full h-72 bg-black/30 rounded-xl p-4 font-mono text-sm text-white/90 outline-none resize-y border border-white/10 focus:border-accent-400/50"
            />
          </motion.div>
        ) : (
          <motion.div
            key="sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass relative"
          >
            <EditToggle editing={false} onClick={() => setEditing(true)} />
            <div
              ref={sheetRef}
              className={`p-5 sm:p-7 font-mono text-[15px] leading-relaxed overflow-y-auto ${showTips ? 'max-h-[55vh]' : 'max-h-[calc(100vh-13rem)]'}`}
            >
              {model.lines.map((line, li) => {
              if (line.type === 'blank') return <div key={li} className="h-4" />
              // Tablature: render VERBATIM — never transposed (the string letters
              // E A D G B e are not chords here).
              if (line.type === 'tab') {
                return (
                  <div key={li} className="whitespace-pre text-white/55 leading-6">
                    {line.text}
                  </div>
                )
              }
              const sectionText = line.pairs.map((p) => p.lyrics).join('')
              if (line.type === 'section') {
                return (
                  <div key={li} className="text-mint-400 font-bold tracking-wide mt-4 mb-1">
                    {sectionText}
                  </div>
                )
              }
              return (
                <div key={li} className="flex flex-wrap whitespace-pre">
                  {line.pairs.map((pair, pi) => (
                    <span key={pi} className="inline-flex flex-col">
                      <span className="h-6 leading-6">
                        {pair.chord && isChord(pair.chord) ? (
                          <InteractiveChord symbol={renderChord(pair.chord)} />
                        ) : (
                          <span className="text-accent-400/80">{pair.chord}</span>
                        )}
                      </span>
                      <span className="text-white/85">{pair.lyrics || ' '}</span>
                    </span>
                  ))}
                </div>
              )
            })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="text-[11px] text-white/30 text-center">
        Tip: press <kbd className="px-1.5 py-0.5 bg-white/10 rounded">+</kbd> /{' '}
        <kbd className="px-1.5 py-0.5 bg-white/10 rounded">−</kbd> to transpose ·{' '}
        <kbd className="px-1.5 py-0.5 bg-white/10 rounded">0</kbd> to reset · tap any chord to hear it
      </p>
    </div>
  )
}

/**
 * Glowing, pulsating note explaining transpose ⇄ capo for beginners. It adapts
 * to the current transpose amount so the advice is concrete, not abstract.
 */
function CapoTransposeNote({ semitones }) {
  const n = semitones
  let headline
  if (n < 0) {
    headline = (
      <>
        You're at <b className="text-white">{n}</b> — to keep the song's original pitch with easier
        shapes, put your <b className="text-mint-300">capo on fret {Math.abs(n)}</b>. No capo? Then
        you're singing <b className="text-accent-200">{Math.abs(n)} semitone{Math.abs(n) > 1 ? 's' : ''} lower</b>.
      </>
    )
  } else if (n > 0) {
    headline = (
      <>
        You're at <b className="text-white">+{n}</b> — this raises the pitch, so you'll{' '}
        <b className="text-accent-200">sing {n} semitone{n > 1 ? 's' : ''} higher</b>. (A capo can't
        lower pitch, so +values are for changing key, not for capo placement.)
      </>
    )
  } else {
    headline = (
      <>
        <b className="text-mint-300">Transpose −1 = Capo on fret 1</b>, −2 = fret 2, and so on — same
        pitch as the record, but easier open chords. Going <b className="text-accent-200">+</b> means
        no capo and singing higher; <b className="text-accent-200">−</b> without a capo means singing
        lower.
      </>
    )
  }
  return (
    <motion.div
      animate={{
        boxShadow: [
          '0 0 0px rgba(139,92,246,0.0), inset 0 0 20px rgba(139,92,246,0.05)',
          '0 0 26px -4px rgba(139,92,246,0.55), inset 0 0 24px rgba(52,211,153,0.10)',
          '0 0 0px rgba(139,92,246,0.0), inset 0 0 20px rgba(139,92,246,0.05)',
        ],
      }}
      transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
      className="rounded-2xl border border-accent-400/30 bg-gradient-to-r from-accent-500/10 to-mint-500/10 px-4 py-3 flex items-start gap-3"
    >
      <motion.span
        animate={{ scale: [1, 1.15, 1], rotate: [0, -6, 0] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        className="text-xl shrink-0"
      >
        🎸
      </motion.span>
      <p className="text-[13px] leading-relaxed text-white/80">{headline}</p>
    </motion.div>
  )
}
