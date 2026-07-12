import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * MicButton — live microphone capture with a volume-reactive ripple.
 *
 * While listening, three concentric rings pulse outward and the whole button
 * breathes with the input RMS (read from an AnalyserNode). On stop, it hands the
 * recorded audio back as an ArrayBuffer via onCapture(bytes, mimeType).
 */
export default function MicButton({ onCapture, disabled }) {
  const [listening, setListening] = useState(false)
  const [level, setLevel] = useState(0) // 0..1 smoothed RMS
  const [elapsed, setElapsed] = useState(0)

  const mediaRef = useRef(null)
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const chunksRef = useRef([])
  const startRef = useRef(0)

  useEffect(() => () => cleanup(), [])

  function cleanup() {
    cancelAnimationFrame(rafRef.current)
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop()
      } catch {
        /* already stopped */
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    mediaRef.current?.close?.()
    streamRef.current = null
    mediaRef.current = null
  }

  async function start() {
    if (disabled) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      streamRef.current = stream

      // Analyser for the reactive ripple.
      const AC = window.AudioContext || window.webkitAudioContext
      const ac = new AC()
      mediaRef.current = ac
      const source = ac.createMediaStreamSource(stream)
      const analyser = ac.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)

      const meter = () => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / buf.length)
        setLevel((prev) => prev * 0.7 + Math.min(1, rms * 3.2) * 0.3) // smoothed
        setElapsed((Date.now() - startRef.current) / 1000)
        rafRef.current = requestAnimationFrame(meter)
      }

      // Recorder.
      chunksRef.current = []
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data)
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        const bytes = await blob.arrayBuffer()
        cleanup()
        setListening(false)
        setLevel(0)
        if (bytes.byteLength > 1000) onCapture(bytes, rec.mimeType)
      }
      recorderRef.current = rec
      startRef.current = Date.now()
      rec.start()
      setListening(true)
      rafRef.current = requestAnimationFrame(meter)
    } catch (err) {
      console.error('Mic access denied', err)
      alert('Microphone access was blocked. Please allow it and try again.')
    }
  }

  function stop() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  const scale = 1 + level * 0.18

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative grid place-items-center" style={{ width: 120, height: 120 }}>
        {/* Reactive ripple rings */}
        <AnimatePresence>
          {listening &&
            [0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="absolute rounded-full border border-rose-400/40 bg-rose-500/5"
                style={{ width: 80, height: 80 }}
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 1.9 + level * 1.2, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.6, ease: 'easeOut' }}
              />
            ))}
        </AnimatePresence>

        <motion.button
          type="button"
          onClick={listening ? stop : start}
          disabled={disabled}
          animate={{ scale: listening ? scale : 1 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          className={`relative z-10 grid place-items-center rounded-full text-2xl shadow-glow disabled:opacity-40 ${
            listening
              ? 'bg-gradient-to-br from-rose-400 to-rose-600'
              : 'bg-gradient-to-br from-accent-400 to-accent-600'
          }`}
          style={{ width: 80, height: 80 }}
        >
          {listening ? (
            <motion.span
              className="block rounded-md bg-white"
              style={{ width: 22, height: 22 }}
              animate={{ scale: [1, 0.85, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          ) : (
            '🎤'
          )}
        </motion.button>
      </div>

      <div className="text-center">
        {listening ? (
          <span className="font-mono text-sm text-rose-300">
            ● {fmt(elapsed)} — tap to finish
          </span>
        ) : (
          <span className="text-sm text-white/60">Record live from your mic</span>
        )}
      </div>
    </div>
  )
}

const fmt = (s) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
