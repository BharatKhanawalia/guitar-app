import { useRef, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { analyzeInWorker } from '../../lib/chordWorkerClient'
import { useStore } from '../../store.jsx'
import MicButton from './MicButton'
import ResultModal from './ResultModal'

/**
 * AudioToChords — the "Audio → Chords" tab.
 *
 * Two engines, selected as tabs:
 *   • Traditional (Math)  — the full local DSP pipeline (100% client-side, $0).
 *   • AI (Local)          — a TensorFlow.js on-device model. Not shipped yet, so
 *                           it shows an honest "coming soon" state rather than
 *                           faking chords with the DSP math.
 * Nothing ever leaves the browser.
 */

const STEPS = [
  { n: 1, t: 'Open your song on YouTube and copy the URL.' },
  { n: 2, t: 'Search Google for a "YouTube to MP3/WAV" site.' },
  { n: 3, t: 'Paste the URL, download the high-quality MP3/WAV.' },
  { n: 4, t: 'Drop the file below to see the magic! ✨' },
]

export default function AudioToChords() {
  const { preferFlats } = useStore()
  const [engine, setEngine] = useState('traditional') // 'traditional' | 'ai'
  const [drag, setDrag] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('') // '', 'working', 'error'
  const [phase, setPhase] = useState('') // loading label (AI: model / separating / analysing)
  const [errMsg, setErrMsg] = useState('')
  const [result, setResult] = useState(null)
  const [audioBytes, setAudioBytes] = useState(null)
  const [title, setTitle] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [sepNote, setSepNote] = useState(false) // true when AI ran without a model
  const inputRef = useRef(null)

  async function process(bytes, name) {
    setStatus('working')
    setProgress(0)
    setErrMsg('')
    setPhase('')
    setSepNote(false)
    setTitle(name?.replace(/\.[^.]+$/, '') || 'Live Recording')
    const pct = (p) => setProgress(Math.round(p * 100))
    try {
      const forPlayback = bytes.slice(0) // pristine copy for playback (full mix)
      const forLyrics = bytes.slice(0) // fallback copy for Whisper (raw mix, if no vocal stem)
      let res
      let lyricsInput = null // { pcm, sampleRate } isolated vocal stem, when available
      if (engine === 'ai') {
        const ai = await processAI(bytes, pct)
        res = ai.res
        lyricsInput = ai.lyricsInput
      } else {
        const sep = await import('../../lib/separation')
        setPhase('Decoding')
        const { data, sampleRate } = await sep.decodeMono(bytes, 44100)
        setPhase('Analysing')
        res = await analyzeInWorker(data, sampleRate, { engine: 'accurate', preferFlats }, pct)
        res.engineLabel = 'Traditional (DSP)'
      }
      if (!res.segments.length) {
        throw new Error('No chords could be detected — the audio may be too quiet or percussive.')
      }
      setAudioBytes(forPlayback)
      res.lyricsStatus = 'transcribing'
      setResult(res)
      setStatus('')
      setModalOpen(true)
      // Auto lyrics: chords are already on screen; transcribe in the background.
      // Prefer the SEPARATED VOCAL stem (AI path) so Whisper reads a clean voice.
      runLyrics(lyricsInput || forLyrics)
    } catch (e) {
      console.error(e)
      setStatus('error')
      setErrMsg(e.message || 'Could not process this audio file.')
    }
  }

  /**
   * AI path: decode → (load model) → separate vocals → analyse the INSTRUMENTAL.
   * Falls back to the raw mix (identity separation) if no model asset is present,
   * and says so — we don't pretend to separate when there's nothing to run.
   */
  async function processAI(bytes, pct) {
    const sep = await import('../../lib/separation')
    setPhase('Decoding')
    const { data, sampleRate } = await sep.decodeMono(bytes, 44100)

    // Separation runs in a Web Worker so the UI never freezes. Best-effort: if the
    // on-device model can't load or run (network, WASM, memory), we DON'T fail —
    // we analyse the raw mix and flag it, so the tab always produces a result.
    let instrumental = data
    let separated = false
    let vocal = null
    if (sep.hasSeparationModel()) {
      try {
        setPhase('Loading AI model (first run downloads 66 MB)')
        instrumental = await sep.separateInWorker(data, {
          onProgress: (phase, p) => {
            if (phase === 'model') {
              setPhase('Loading AI model (first run downloads 66 MB)')
              pct(p * 0.4)
            } else {
              setPhase('Separating vocals (on-device)')
              pct(0.4 + p * 0.35)
            }
          },
        })
        separated = true
        // Vocal stem = mix − instrumental (residual). This is what Whisper reads.
        const n = Math.min(data.length, instrumental.length)
        vocal = new Float32Array(n)
        for (let i = 0; i < n; i++) vocal[i] = data[i] - instrumental[i]
      } catch (e) {
        console.warn('AI separation failed — falling back to raw mix:', e)
        setSepNote(true)
        instrumental = data
      }
    } else {
      setSepNote(true)
    }

    setPhase('Analysing')
    const res = await analyzeInWorker(
      instrumental,
      sampleRate,
      { engine: 'accurate', preferFlats },
      (p) => pct(0.75 + p * 0.25),
    )
    res.engineLabel = separated ? 'AI Neural · vocals separated' : 'AI · raw mix (separation unavailable)'
    return { res, lyricsInput: vocal ? { pcm: vocal, sampleRate } : null }
  }

  /** Background lyric transcription — updates result.lyrics in place when done.
   *  `input` is the isolated vocal stem {pcm, sampleRate} (AI) or raw file bytes. */
  async function runLyrics(input) {
    try {
      const { transcribeLyrics } = await import('../../lib/whisper')
      const lyrics = await transcribeLyrics(input)
      setResult((prev) => (prev ? { ...prev, lyrics, lyricsStatus: lyrics ? 'done' : 'empty' } : prev))
    } catch (e) {
      console.warn('Lyrics transcription failed — chords still work:', e)
      setResult((prev) => (prev ? { ...prev, lyricsStatus: 'error' } : prev))
    }
  }

  async function onFile(file, evt) {
    // Clear the input so re-selecting the SAME file fires onChange again.
    if (evt?.target) evt.target.value = ''
    if (!file) return
    if (!/audio|\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.type + file.name)) {
      setStatus('error')
      setErrMsg('Please drop an audio file (.mp3, .wav, .m4a, …).')
      return
    }
    const bytes = await file.arrayBuffer()
    process(bytes, file.name)
  }

  function closeModal() {
    setModalOpen(false)
    if (inputRef.current) inputRef.current.value = '' // re-enable same-file re-upload
  }

  const working = status === 'working'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* How it works */}
      <section className="glass p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">💡</span>
          <h3 className="font-bold">How it works</h3>
          <span className="chip !py-0.5 !px-2 text-[11px] text-mint-400 ml-auto">
            100% in your browser · $0 · private
          </span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {STEPS.map((s) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: s.n * 0.06 }}
              className="flex items-start gap-3 glass-soft px-4 py-3"
            >
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent-500/80 grid place-items-center text-xs font-bold">
                {s.n}
              </span>
              <span className="text-sm text-white/80">{s.t}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Engine tabs */}
      <EngineToggle engine={engine} onChange={setEngine} disabled={working} />

      {/* AI separation roadmap + model status (shown above the upload for AI) */}
      {engine === 'ai' && <AiPanel />}

      {/* Upload / mic — used by BOTH engines (AI routes through separation first) */}
      <AnimatePresence mode="wait">
        {(
          <motion.section
            key="upload"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass p-5 sm:p-6"
          >
            <motion.div
              onDragOver={(e) => {
                e.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                onFile(e.dataTransfer.files?.[0])
              }}
              onClick={() => !working && inputRef.current?.click()}
              animate={{
                borderColor: drag ? 'rgba(167,139,250,0.8)' : 'rgba(255,255,255,0.15)',
                backgroundColor: drag ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.02)',
              }}
              className="relative cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center overflow-hidden"
            >
              <input
                ref={inputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0], e)}
              />
              <AnimatePresence mode="wait">
                {working ? (
                  <motion.div key="prog" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <div className="text-4xl mb-3">{engine === 'ai' ? '🧠' : '🎧'}</div>
                    <p className="font-semibold mb-1">{phase || 'Analysing'} “{title}”…</p>
                    <p className="text-[11px] text-white/40 mb-3">{engine === 'ai' ? 'on-device separation → chords' : 'local DSP'}</p>
                    <div className="max-w-xs mx-auto h-2 rounded-full bg-white/10 overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-accent-500 to-mint-400"
                        animate={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-white/50 mt-2 font-mono">{progress}%</p>
                  </motion.div>
                ) : (
                  <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <motion.div animate={{ y: drag ? -6 : 0, scale: drag ? 1.1 : 1 }} className="text-5xl mb-3">
                      {drag ? '📥' : '🎵'}
                    </motion.div>
                    <p className="font-bold text-lg">{drag ? 'Drop it!' : 'Drag & drop your MP3 / WAV'}</p>
                    <p className="text-sm text-white/50 mt-1">or click to browse</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            <div className="flex items-center gap-4 my-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs uppercase tracking-widest text-white/40">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <MicButton onCapture={(bytes) => process(bytes)} disabled={working} />

            <AnimatePresence>
              {status === 'error' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-5 text-center text-sm text-rose-300 bg-rose-500/10 border border-rose-400/20 rounded-xl px-4 py-3"
                >
                  {errMsg}
                </motion.div>
              )}
              {sepNote && status !== 'error' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-5 text-center text-[12px] text-amber-200/80 bg-amber-400/10 border border-amber-300/20 rounded-xl px-4 py-2.5"
                >
                  No separation model installed — analysed the raw mix. Add a model for the real
                  vocal-isolated result.
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>

      <ResultModal
        open={modalOpen}
        onClose={closeModal}
        result={result}
        audioBytes={audioBytes}
        preferFlats={preferFlats}
        title={title}
      />
    </div>
  )
}

function EngineToggle({ engine, onChange, disabled }) {
  const opts = [
    { id: 'traditional', label: 'Traditional', sub: 'Math · local DSP · $0', icon: '⚙️' },
    { id: 'ai', label: 'AI Neural (Local)', sub: 'On-device TFJS · soon', icon: '⚡' },
  ]
  return (
    <div className="glass p-2 flex gap-2">
      {opts.map((o) => {
        const active = engine === o.id
        return (
          <button
            key={o.id}
            onClick={() => !disabled && onChange(o.id)}
            disabled={disabled}
            className={`relative flex-1 rounded-2xl px-4 py-3 text-left transition-colors disabled:opacity-50 ${
              active ? 'text-white' : 'text-white/60 hover:text-white/90'
            }`}
          >
            {active && (
              <motion.span
                layoutId="engine-pill"
                className="absolute inset-0 rounded-2xl bg-accent-500/25 border border-accent-400/50 -z-10"
                transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              />
            )}
            <div className="flex items-center gap-2 font-semibold">
              <span>{o.icon}</span>
              {o.label}
              {o.id === 'ai' && <span className="chip !py-0 !px-1.5 text-[10px] text-mint-400">soon</span>}
            </div>
            <div className="text-[11px] text-white/50 mt-0.5">{o.sub}</div>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The local AI engine. Real-world testing against ground-truth tracks showed the
 * DSP ceiling: on dense mixes the vocal masks the guitar so the chromagram itself
 * is corrupted. This pipeline runs on-device source separation, then reads chords
 * from the clean instrumental and transcribes lyrics from the isolated vocal — all
 * in the browser, still $0. Nothing is uploaded.
 */
const AI_STAGES = [
  { icon: '🎛️', t: 'Stem separation', d: 'A UVR-MDX neural model (ONNX Runtime Web) splits vocals from the backing track on-device, so chords are read from the clean instrumental, not the vocal-masked mix.' },
  { icon: '🎸', t: 'Chord analysis', d: 'The DSP chord engine runs on the separated instrumental — cleaner chroma than the raw mix, which is where it struggles most.' },
  { icon: '🎤', t: 'Lyric transcription', d: 'Whisper (transformers.js) runs on the isolated vocal stem → auto-generated lyrics. Isolating the vocal first is what makes it readable over music.' },
]
function AiPanel() {
  // Check the model availability once, off the render path.
  const [modelReady, setModelReady] = useState(null)
  useEffect(() => {
    let alive = true
    import('../../lib/separation')
      .then((m) => alive && setModelReady(m.hasSeparationModel()))
      .catch(() => alive && setModelReady(false))
    return () => { alive = false }
  }, [])
  return (
    <section className="glass p-5 sm:p-6 relative overflow-hidden">
      <div className="absolute -top-24 -right-16 h-56 w-56 rounded-full bg-accent-500/20 blur-3xl pointer-events-none" />
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🧠</span>
        <h3 className="font-bold">AI Neural pipeline (on-device separation)</h3>
        <span className="chip !py-0.5 !px-2 text-[11px] ml-auto text-mint-400">
          {modelReady === false ? 'unavailable' : 'on-device'}
        </span>
      </div>
      <div className="grid sm:grid-cols-3 gap-2.5">
        {AI_STAGES.map((s, i) => (
          <motion.div
            key={s.t}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="glass-soft px-3 py-2.5"
          >
            <div className="flex items-center gap-1.5 font-semibold text-[13px]">
              <span>{s.icon}</span>
              {s.t}
            </div>
            <div className="text-[11px] text-white/50 mt-1 leading-snug">{s.d}</div>
          </motion.div>
        ))}
      </div>
      <p className="text-[11px] text-white/45 mt-3 leading-relaxed">
        Heads up: the first AI run <span className="text-white/70">downloads a ~66 MB separation model</span>{' '}
        (plus the Whisper lyric model on demand) and caches it in your browser. Separation runs entirely
        on your device — nothing is uploaded — but it&rsquo;s CPU-heavy and can take a minute or two per song.
        On a dense mix where separation can&rsquo;t cleanly isolate the guitar, results still improve but
        aren&rsquo;t perfect.
      </p>
    </section>
  )
}
