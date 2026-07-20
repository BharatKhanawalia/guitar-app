import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { createTuner } from '../lib/tuner'
import { playTunedChime } from '../lib/audioEngine'
import Headstock from './Headstock'

export default function Tuner() {
  const [active, setActive] = useState(false)
  const [pitch, setPitch] = useState(null)
  const [error, setError] = useState(null)
  const stopRef = useRef(null)

  // Edge-trigger the "in tune!" chime: fire once when a string settles in tune,
  // then arm again only after it drifts back out.
  const tunedRef = useRef(false)

  const start = async () => {
    setError(null)
    try {
      stopRef.current = await createTuner(setPitch)
      setActive(true)
    } catch (e) {
      setError(micErrorMessage(e))
    }
  }

  const stop = () => {
    stopRef.current?.()
    stopRef.current = null
    setActive(false)
    setPitch(null)
    tunedRef.current = false
  }

  useEffect(() => () => stopRef.current?.(), [])

  const cents = pitch?.cents ?? 0
  const inTune = pitch?.inTune ?? false

  // Chime + re-arm logic.
  useEffect(() => {
    if (inTune && !tunedRef.current) {
      tunedRef.current = true
      playTunedChime()
    } else if (!inTune && Math.abs(cents) > 12) {
      tunedRef.current = false
    }
  }, [inTune, cents])

  // Cents → position on the ±50¢ strip.
  const pos = Math.max(-50, Math.min(50, cents))
  const pct = 50 + (pos / 50) * 50

  return (
    <div className="glass p-6 sm:p-8 flex flex-col items-center">
      <div className="flex items-center justify-between w-full mb-2">
        <div>
          <h3 className="font-bold text-lg">Guitar Tuner</h3>
          <p className="text-xs text-white/40">Pluck a string — we listen and show you exactly how to tune it.</p>
        </div>
        <button onClick={active ? stop : start} className={active ? 'btn-ghost' : 'btn-primary'}>
          {active ? '■ Stop' : '● Start'}
        </button>
      </div>

      {error && <p className="text-rose-300 text-sm my-4">{error}</p>}

      {/* Headstock visualization */}
      <div className="w-full mt-2">
        <Headstock pitch={pitch} active={active} inTune={inTune} />
      </div>

      {/* Readout */}
      <div className="text-center mt-4 h-24 flex flex-col justify-center">
        {pitch ? (
          <>
            <motion.div
              key={pitch.note.label}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`text-6xl font-black tabular-nums ${inTune ? 'text-mint-400' : 'text-white'}`}
              style={{ textShadow: inTune ? '0 0 24px rgba(52,211,153,0.6)' : 'none' }}
            >
              {pitch.note.name}
              <span className="text-2xl text-white/40 align-top">{pitch.note.octave}</span>
            </motion.div>
            <p className="text-sm text-white/50 mt-1">
              {pitch.freq.toFixed(1)} Hz ·{' '}
              <span className={inTune ? 'text-mint-400' : cents > 0 ? 'text-amber-300' : 'text-sky-300'}>
                {cents > 0 ? '+' : ''}
                {cents}¢ {inTune ? 'in tune ✓' : cents > 0 ? 'sharp' : 'flat'}
              </span>
            </p>
          </>
        ) : (
          <p className="text-white/40">
            {active ? 'Pluck a string…' : 'Press start and allow microphone access.'}
          </p>
        )}
      </div>

      {/* Cents strip */}
      <div className="w-full max-w-sm mt-2">
        <div className="relative h-2 rounded-full bg-white/10 overflow-visible">
          {/* center in-tune zone */}
          <div className="absolute left-1/2 -translate-x-1/2 top-0 h-full w-[10%] rounded-full bg-mint-400/25" />
          <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 h-4 w-px bg-mint-400/60" />
          {pitch && (
            <motion.div
              className="absolute top-1/2 w-4 h-4 rounded-full -translate-x-1/2 -translate-y-1/2"
              animate={{ left: `${pct}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              style={{
                background: inTune ? '#34d399' : '#a78bfa',
                boxShadow: `0 0 12px ${inTune ? '#34d399' : '#8b5cf6'}`,
              }}
            />
          )}
        </div>
        <div className="flex justify-between text-[10px] text-white/30 mt-1 font-mono">
          <span>♭ −50¢</span>
          <span>0</span>
          <span>+50¢ ♯</span>
        </div>
      </div>
    </div>
  )
}

/** Turn a getUserMedia / context error into a specific, actionable message. */
function micErrorMessage(e) {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone permission was blocked. Allow mic access in your browser and try again.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found. Plug one in (or check your device settings) and try again.'
    case 'NotReadableError':
      return 'Your microphone is busy in another app or tab. Close it and try again.'
    case 'InsecureContextError':
      return 'The tuner needs a secure connection (https). Open the site over https and try again.'
    default:
      return 'Could not start the microphone. Check your browser’s mic settings and try again.'
  }
}
