/**
 * tuner.js — robust chromatic pitch detection for guitar.
 *
 * Upgrades over the old naive autocorrelation:
 *   • YIN algorithm (cumulative mean normalized difference) — far fewer octave
 *     errors and stable on a guitar's weak low fundamentals.
 *   • A band-pass on the input stream (≈80 Hz – 1200 Hz) so hum, breath and
 *     high harmonic noise don't get mistaken for a note.
 *   • Median smoothing + a stability gate so the readout stops jittering and
 *     only commits to a note once several consecutive frames agree.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Standard tuning targets (low→high), for the "nearest string" hint.
export const GUITAR_STRINGS = [
  { name: 'E2', label: 'E', freq: 82.41 },
  { name: 'A2', label: 'A', freq: 110.0 },
  { name: 'D3', label: 'D', freq: 146.83 },
  { name: 'G3', label: 'G', freq: 196.0 },
  { name: 'B3', label: 'B', freq: 246.94 },
  { name: 'E4', label: 'e', freq: 329.63 },
]

const MIN_FREQ = 78 // a touch under low-E so a flat 6th string still registers
const MAX_FREQ = 1250

export function freqToNote(freq) {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440))
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  const refFreq = 440 * Math.pow(2, (midi - 69) / 12)
  const cents = Math.round(1200 * Math.log2(freq / refFreq))
  return { name, octave, midi, cents, refFreq, label: `${name}${octave}` }
}

/**
 * YIN pitch estimator. Returns fundamental frequency in Hz, or -1 if no
 * confident pitch is found. `threshold` ~0.1–0.15 (lower = stricter).
 */
export function yin(buffer, sampleRate, threshold = 0.12) {
  const tauMin = Math.floor(sampleRate / MAX_FREQ)
  const tauMax = Math.min(Math.floor(sampleRate / MIN_FREQ), (buffer.length / 2) | 0)

  // RMS gate — ignore near-silence so we don't chase room noise.
  let rms = 0
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i]
  rms = Math.sqrt(rms / buffer.length)
  if (rms < 0.006) return -1

  const yinBuf = new Float32Array(tauMax)

  // 1) Difference function.
  for (let tau = tauMin; tau < tauMax; tau++) {
    let sum = 0
    for (let i = 0; i < tauMax; i++) {
      const delta = buffer[i] - buffer[i + tau]
      sum += delta * delta
    }
    yinBuf[tau] = sum
  }

  // 2) Cumulative mean normalized difference.
  yinBuf[0] = 1
  let running = 0
  for (let tau = tauMin; tau < tauMax; tau++) {
    running += yinBuf[tau]
    yinBuf[tau] = running > 0 ? (yinBuf[tau] * (tau - tauMin + 1)) / running : 1
  }

  // 3) Absolute threshold — first local dip below `threshold`.
  let tauEstimate = -1
  for (let tau = tauMin + 1; tau < tauMax - 1; tau++) {
    if (yinBuf[tau] < threshold) {
      while (tau + 1 < tauMax && yinBuf[tau + 1] < yinBuf[tau]) tau++
      tauEstimate = tau
      break
    }
  }
  if (tauEstimate === -1) return -1 // no periodicity confident enough

  // 4) Parabolic interpolation for sub-sample precision.
  const x0 = tauEstimate > tauMin ? tauEstimate - 1 : tauEstimate
  const x2 = tauEstimate + 1 < tauMax ? tauEstimate + 1 : tauEstimate
  let betterTau = tauEstimate
  if (x0 !== tauEstimate && x2 !== tauEstimate) {
    const s0 = yinBuf[x0]
    const s1 = yinBuf[tauEstimate]
    const s2 = yinBuf[x2]
    const denom = 2 * (2 * s1 - s2 - s0)
    if (denom !== 0) betterTau = tauEstimate + (s2 - s0) / denom
  }

  const freq = sampleRate / betterTau
  if (freq < MIN_FREQ || freq > MAX_FREQ) return -1
  return freq
}

/** Median of a numeric array (used to smooth the frequency stream). */
function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Create a live tuner session bound to the microphone.
 * `onPitch({ freq, note, nearestString, inTune, cents })` fires ~60×/sec while
 * a stable note is present, or `null` when silent.
 * Returns a stop() function.
 */
export async function createTuner(onPitch) {
  // Insecure context (http, not localhost) → mediaDevices is undefined. Fail with a
  // clear, catchable error rather than a confusing "undefined" TypeError.
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('insecure-context')
    err.name = 'InsecureContextError'
    throw err
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
  })
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  // iOS Safari (and some autoplay states) start the context SUSPENDED — without an
  // explicit resume the analyser never runs and the tuner shows nothing. We're
  // inside a user-gesture-triggered call, so this is allowed.
  try { await ctx.resume() } catch { /* best effort */ }
  const source = ctx.createMediaStreamSource(stream)

  // --- Band-pass the stream to guitar range (≈80–1200 Hz) ---------------
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 80
  hp.Q.value = 0.7
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1200
  lp.Q.value = 0.7

  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0

  source.connect(hp)
  hp.connect(lp)
  lp.connect(analyser)

  const buffer = new Float32Array(analyser.fftSize)
  const history = [] // recent frequency estimates for median smoothing
  const HIST = 8
  let raf = null
  let stopped = false
  let silence = 0
  let ema = null // exponential moving average of frequency (the smoothed value shown)

  const tick = () => {
    if (stopped) return
    analyser.getFloatTimeDomainData(buffer)
    const freq = yin(buffer, ctx.sampleRate)

    if (freq > 0) {
      history.push(freq)
      if (history.length > HIST) history.shift()
      silence = 0

      // Require a few frames before trusting the pitch, then use the median so
      // a single stray estimate can't jerk the needle.
      if (history.length >= 3) {
        const med = median(history)
        // Reject frames that disagree wildly with the running median (glitches).
        const spread = Math.abs(freq - med) / med
        if (spread < 0.08) {
          // Exponential smoothing in the log/cents domain. Adaptive: snap quickly
          // when you pluck a different string (big jump), then settle to a heavy
          // smoothing so a held note reads rock-steady instead of dancing ±cents.
          const jumpCents = ema ? Math.abs(1200 * Math.log2(med / ema)) : 9999
          const alpha = jumpCents > 90 ? 0.6 : jumpCents > 30 ? 0.3 : 0.12
          ema = ema == null ? med : Math.exp(Math.log(ema) * (1 - alpha) + Math.log(med) * alpha)

          const note = freqToNote(ema)
          const nearestString = GUITAR_STRINGS.reduce((best, s) =>
            Math.abs(s.freq - ema) < Math.abs(best.freq - ema) ? s : best,
          )
          onPitch({
            freq: ema,
            note,
            cents: note.cents,
            nearestString,
            inTune: Math.abs(note.cents) <= 5,
          })
        }
      }
    } else {
      // Debounce silence so brief note decays don't blank the display.
      silence++
      if (silence > 12) {
        history.length = 0
        ema = null
        onPitch(null)
      }
    }
    raf = requestAnimationFrame(tick)
  }
  tick()

  return () => {
    stopped = true
    if (raf) cancelAnimationFrame(raf)
    stream.getTracks().forEach((t) => t.stop())
    ctx.close()
  }
}
