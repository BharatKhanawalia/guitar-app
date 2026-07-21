import { useState } from 'react'
import { motion, LayoutGroup } from 'framer-motion'
import Background from './components/Background'
import CursorNotes from './components/CursorNotes'
import GlowCursor from './components/GlowCursor'
import AmbientParticles from './components/AmbientParticles'
import HomePage from './components/HomePage'
import TopBar from './components/TopBar'
import MenuOverlay from './components/MenuOverlay'
import ModuleIcon from './components/NavIcons'
import ChordPicker from './components/ChordPicker'
import CapoOptimizer from './components/CapoOptimizer'
import SheetTransposer from './components/SheetTransposer'
import Tuner from './components/Tuner'
import StrummingStudio from './components/StrummingStudio'
// Magic Chords + Audio → Chords each open behind a Fretwork intro card; the
// heavy studio/DSP bundles lazy-load from inside those panels.
import MagicChordsPanel from './components/MagicChordsPanel'
import AudioToChordsPanel from './components/AudioToChordsPanel'
import EnharmonicToggle from './components/EnharmonicToggle'
import FretboardDiagram from './components/FretboardDiagram'
import ErrorBoundary from './components/ErrorBoundary'
import { isChord, respellChord } from './lib/chordTheory'
import { useStore } from './store.jsx'

const TABS = [
  { id: 'capo', label: 'Capo Calculator' },
  { id: 'sheet', label: 'Sheet Transposer' },
  { id: 'strum', label: 'Strumming Studio' },
  { id: 'audio', label: 'Audio → Chords' },
  { id: 'tuner', label: 'Guitar Tuner' },
  { id: 'ar', label: 'Magic Chords' },
]

const pageVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -16 },
}

export default function App() {
  const [tab, setTab] = useState('home')
  const [menuOpen, setMenuOpen] = useState(false)
  // True while the Magic Chords studio is full-screen — the app chrome (top bar,
  // cursor effects) is removed so it can't cover the studio's own controls.
  const [immersive, setImmersive] = useState(false)
  const { chords, setChords, preferFlats, setPreferFlats } = useStore()
  const [manual, setManual] = useState('')

  // Switch module and always dismiss the overlay menu.
  const navigate = (id) => {
    setTab(id)
    setMenuOpen(false)
  }
  const isHome = tab === 'home'

  const addManual = (e) => {
    e.preventDefault()
    const tokens = manual.split(/[\s,|]+/).filter(Boolean)
    const valid = tokens.filter(isChord).map((c) => respellChord(c, preferFlats))
    if (valid.length) {
      setChords((prev) => [...new Set([...prev, ...valid])])
      setManual('')
    }
  }

  // Everything on the Capo tab renders through the current spelling convention.
  const displayChords = chords.map((c) => respellChord(c, preferFlats))

  return (
    <>
      <Background />
      {!immersive && <AmbientParticles />}
      {!immersive && <CursorNotes />}
      {!immersive && <GlowCursor />}

      {!immersive && (
        <>
          <MenuOverlay open={menuOpen} current={tab} onNavigate={navigate} onClose={() => setMenuOpen(false)} />
          <TopBar
            menuOpen={menuOpen}
            onToggleMenu={() => setMenuOpen((o) => !o)}
            onLogoClick={() => navigate('home')}
          />
        </>
      )}

      <div className="min-h-screen max-w-6xl mx-auto px-4 sm:px-6 pb-24 pt-6">
        {/* Tab nav — hidden on the Home landing page (reach modules via the
            hero cards or the overlay menu). */}
        {!isHome && (
          <LayoutGroup>
            <nav className="glass p-1.5 inline-flex gap-1 mb-8 w-full sm:w-auto overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  data-active={tab === t.id}
                  className="gt-ico-host gt-navbtn relative inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl font-semibold text-sm whitespace-nowrap transition-colors"
                >
                  {tab === t.id && (
                    <motion.span
                      layoutId="tab-pill"
                      className="absolute inset-0 bg-accent-500/80 rounded-xl shadow-glow -z-10"
                      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                    />
                  )}
                  <span className="flex shrink-0" aria-hidden="true">
                    <ModuleIcon id={t.id} size={15} />
                  </span>
                  {t.label}
                </button>
              ))}
            </nav>
          </LayoutGroup>
        )}

        {/* Pages — keyed motion.div so switching tabs unmounts the previous page
            synchronously (mic released, timers cleared). Shared chord/sheet state
            now lives in the global store, so it survives the unmount. */}
        <div>
          <motion.div
            key={tab}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            transition={{ duration: 0.28 }}
          >
           <ErrorBoundary label="This section">
            {tab === 'home' && <HomePage onOpen={navigate} />}

            {tab === 'capo' && (
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 items-start">
                {/* Left: input */}
                <div className="space-y-6">
                  <section className="glass p-5 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="font-bold text-lg">Chord Picker</h2>
                      <EnharmonicToggle flats={preferFlats} onChange={setPreferFlats} id="capo" />
                    </div>
                    <ChordPicker selected={chords} onChange={setChords} preferFlats={preferFlats} />

                    {/* Manual entry */}
                    <form onSubmit={addManual} className="mt-5 flex gap-2">
                      <input
                        value={manual}
                        onChange={(e) => setManual(e.target.value)}
                        placeholder="Type chords: Bb Dm Gm7 F …"
                        className="flex-1 bg-black/30 border border-white/10 focus:border-accent-400/50 rounded-xl px-4 py-2.5 font-mono text-sm outline-none"
                      />
                      <button type="submit" className="btn-primary">
                        Add
                      </button>
                    </form>
                    <p className="text-[11px] text-white/40 mt-2">
                      Type each chord separated by a space.
                    </p>
                  </section>

                  {/* Diagram strip for current progression */}
                  {displayChords.length > 0 && (
                    <section className="glass p-5">
                      <h3 className="text-xs uppercase tracking-widest text-white/40 mb-3">
                        Shapes as written
                      </h3>
                      <div className="flex gap-4 overflow-x-auto pb-2">
                        {displayChords.map((c, i) => (
                          <div key={`${c}-${i}`} className="flex flex-col items-center shrink-0">
                            <FretboardDiagram symbol={c} size="sm" />
                            <span className="font-mono text-xs mt-1 text-white/80">{c}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>

                {/* Right: results */}
                <section>
                  <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
                    Capo Comparison
                    <span className="text-xs font-normal text-white/40">
                      frets 0–11 ranked by playability
                    </span>
                  </h2>
                  <CapoOptimizer chords={chords} preferFlats={preferFlats} />
                </section>
              </div>
            )}

            {tab === 'sheet' && <SheetTransposer />}

            {tab === 'strum' && <StrummingStudio />}

            {tab === 'audio' && <AudioToChordsPanel />}

            {tab === 'tuner' && (
              <div className="max-w-xl mx-auto">
                <Tuner />
              </div>
            )}

            {tab === 'ar' && <MagicChordsPanel onImmersiveChange={setImmersive} />}
           </ErrorBoundary>
          </motion.div>
        </div>

        <SiteFooter />
      </div>
    </>
  )
}

/* Consumer-facing footer: FAQ · Contact · legal placeholders. */
const FAQ = [
  { q: 'Is CapoFlow free?', a: 'Yes — completely free, with no sign-up. Everything runs right in your browser.' },
  { q: 'Does my audio get uploaded anywhere?', a: 'No. Your microphone and any audio you use stay on your device — nothing is sent to a server.' },
  { q: 'What is a capo, and how does the Capo Calculator help?', a: 'A capo clamps the strings to raise the pitch so you can play easier open-chord shapes. The calculator finds the fret that makes your song easiest to play.' },
  { q: 'Do I need to install anything?', a: 'No installation — it works in any modern browser on desktop or mobile.' },
]
function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-white/10 pt-10 pb-6">
      <div className="grid gap-8 sm:grid-cols-3 text-sm">
        <div>
          <h3 className="font-bold mb-2 flex items-center gap-2"><span className="text-accent-400">🎸</span> CapoFlow</h3>
          <p className="text-white/45 leading-relaxed text-[13px]">
            Play smarter, sound the same. Free tools to find easier chords, transpose sheets, tune your
            guitar and practice your strumming — all in your browser.
          </p>
        </div>
        <div>
          <h4 className="font-semibold mb-2 text-white/80">FAQ</h4>
          <ul className="space-y-2">
            {FAQ.map((f) => (
              <li key={f.q}>
                <details className="group">
                  <summary className="cursor-pointer text-white/60 hover:text-white/90 marker:text-accent-400/70 text-[13px]">
                    {f.q}
                  </summary>
                  <p className="text-white/40 text-[12px] mt-1 leading-relaxed">{f.a}</p>
                </details>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-2 text-white/80">Contact</h4>
          <p className="text-white/45 text-[13px]">
            Questions or feedback? Mail us at{' '}
            <a href="mailto:" className="text-accent-300 hover:text-accent-200 underline decoration-dotted">
              [your email here]
            </a>
            .
          </p>
          <div className="flex gap-4 mt-4 text-[12px] text-white/40">
            <a href="#" className="hover:text-white/70">Terms</a>
            <a href="#" className="hover:text-white/70">Privacy</a>
          </div>
        </div>
      </div>
      <div className="text-center text-[11px] text-white/25 mt-8">
        © {2026} CapoFlow · Made for guitarists everywhere.
      </div>
    </footer>
  )
}
