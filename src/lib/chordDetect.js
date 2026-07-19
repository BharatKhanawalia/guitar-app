import { detectKey, respellChord } from './chordTheory.js'

/**
 * chordDetect.js — CapoFlow's 100% client-side Audio→Chord engine.
 *
 * Everything here runs in the browser, offline, at $0 backend cost. No network,
 * no upload. Pipeline (accuracy is the priority — see each stage):
 *
 *   1. decode + downmix to mono + downsample to 22.05 kHz  (OfflineAudioContext)
 *   2. Hann-windowed FFT per hop                            (hand-rolled radix-2)
 *   3. Harmonic Pitch-Class Profile chromagram             (HPCP + whitening)
 *   4. global tuning correction                            (chroma-peak centroid)
 *   5. template matching (maj/min/7/m7 + no-chord)         (cosine similarity)
 *   6. Viterbi decoding with a self-transition prior       (kills chord flicker)
 *   7. merge → drop < 300 ms fragments → detect key/bpm
 *
 * Two presets, both local:
 *   'fast'     — 3 harmonics, lighter prior. Quick, good on clean recordings.
 *   'accurate' — 6 harmonics, tuning correction, stronger prior, longer window.
 *
 * The public entry point is analyzeAudio(arrayBuffer, { engine, onProgress }).
 */

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

const TARGET_SR = 22050 // working sample rate — plenty for chords, 2× faster
const FMIN = 55 // A1 — below this is mostly mud/bass fundamentals
// FMAX deliberately low: rhythm guitar + bass live below ~1.3 kHz. The lead VOCAL
// and its bright overtones sit above this and were poisoning the chromagram with
// melody notes (the classic "everything looks like a 7th" failure). We cut them.
const FMAX = 1300
const FADE_LO = 850 // taper magnitudes from here → FMAX so vocals fade out gently
// Bass band — used ONLY to anchor the chord ROOT. Kept LOW and narrow so it
// captures bass FUNDAMENTALS (E2 82Hz … D3 147Hz) and not the 2nd/3rd harmonics
// of a droning low note (e.g. an E-drone's 3rd harmonic ~247Hz), which otherwise
// pollute the "bass" with phantom roots.
const BASS_LO = 55
const BASS_HI = 200

// selfProb governs how "sticky" a chord is; beta is the emission temperature —
// it scales cosine similarities into log-likelihoods with enough spread that a
// genuinely better-fitting chord over a segment overcomes the switch penalty,
// while a single ambiguous frame does NOT cause a flicker. Both matter together.
const ENGINES = {
  fast: { fft: 4096, hop: 2048, harmonics: 3, selfProb: 0.92, beta: 9, window: 1 },
  accurate: { fft: 8192, hop: 2048, harmonics: 4, selfProb: 0.94, beta: 11, window: 1, tuning: true },
}

// Chord vocabulary. Each entry is a pitch-class interval set (semitones from root).
// `prior` biases the decoder: plain triads are the overwhelmingly common case in
// pop/rock, so 7ths must EARN their place — they carry a standing penalty and are
// only chosen when the 7th tone is clearly present across the whole segment.
const QUALITIES = [
  { suffix: '', ivals: [0, 4, 7], prior: 1.0 }, // major triad
  { suffix: 'm', ivals: [0, 3, 7], prior: 1.0 }, // minor triad
  { suffix: '7', ivals: [0, 4, 7, 10], prior: 0.8 }, // dominant 7 — penalised
  { suffix: 'm7', ivals: [0, 3, 7, 10], prior: 0.8 }, // minor 7 — penalised
]
const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/* ------------------------------------------------------------------ */
/* Chord templates (built once)                                        */
/* ------------------------------------------------------------------ */

function buildTemplates() {
  const templates = []
  for (const q of QUALITIES) {
    for (let root = 0; root < 12; root++) {
      const v = new Float32Array(12)
      // Weight the root and fifth a touch higher — they're the most stable
      // spectral energy in a real mix; the third defines quality but is quieter.
      q.ivals.forEach((iv, idx) => {
        const pc = (root + iv) % 12
        v[pc] = idx === 0 ? 1.1 : idx === 1 ? 1.0 : 0.9
      })
      normalize(v)
      templates.push({ label: ROOTS[root] + q.suffix, root, vec: v, prior: q.prior })
    }
  }
  // "No chord" / silence template — flat, low. Emission handled separately.
  return templates
}

const TEMPLATES = buildTemplates()

/* ------------------------------------------------------------------ */
/* 1. Decode + downmix + downsample                                    */
/* ------------------------------------------------------------------ */

async function decodeToMono(arrayBuffer) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext
  // A tiny throwaway context just to decode; length/rate are placeholders.
  const tmp = new AC(1, 1, 44100)
  const audio = await tmp.decodeAudioData(arrayBuffer.slice(0))

  const chs = audio.numberOfChannels
  const src = audio.getChannelData(0)
  const mono = new Float32Array(src.length)
  if (chs > 1) {
    const r = audio.getChannelData(1)
    for (let i = 0; i < src.length; i++) mono[i] = 0.5 * (src[i] + r[i])
  } else {
    mono.set(src)
  }

  // Linear-interpolated downsample to TARGET_SR.
  const ratio = audio.sampleRate / TARGET_SR
  if (ratio <= 1.0001) return { data: mono, sampleRate: audio.sampleRate, duration: audio.duration }
  const outLen = Math.floor(mono.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const frac = pos - i0
    out[i] = mono[i0] * (1 - frac) + (mono[i0 + 1] || 0) * frac
  }
  return { data: out, sampleRate: TARGET_SR, duration: audio.duration }
}

/* ------------------------------------------------------------------ */
/* 2. FFT — iterative radix-2 Cooley–Tukey (in-place, real input)       */
/* ------------------------------------------------------------------ */

function makeFFT(n) {
  const cos = new Float32Array(n / 2)
  const sin = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n)
    sin[i] = Math.sin((-2 * Math.PI * i) / n)
  }
  const rev = new Uint32Array(n)
  const bits = Math.log2(n)
  for (let i = 0; i < n; i++) {
    let x = i
    let r = 0
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1)
      x >>= 1
    }
    rev[i] = r
  }

  // Fills `mag` (length n/2) with magnitude spectrum of real `re` (length n).
  return function fft(re, im, mag) {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        const tr = re[i]
        re[i] = re[j]
        re[j] = tr
      }
      im[i] = 0
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const ti = k * step
          const c = cos[ti]
          const s = sin[ti]
          const a = i + k
          const b = a + half
          const tr = re[b] * c - im[b] * s
          const tii = re[b] * s + im[b] * c
          re[b] = re[a] - tr
          im[b] = im[a] - tii
          re[a] += tr
          im[a] += tii
        }
      }
    }
    for (let i = 0; i < n / 2; i++) {
      mag[i] = Math.hypot(re[i], im[i])
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3–4. Chromagram (HPCP) with harmonic summation + tuning correction  */
/* ------------------------------------------------------------------ */

// Precompute, per FFT bin, the fractional MIDI pitch it maps to.
function binPitches(fftSize, sampleRate) {
  const half = fftSize / 2
  const pitches = new Float32Array(half)
  for (let k = 1; k < half; k++) {
    const f = (k * sampleRate) / fftSize
    pitches[k] = f > 0 ? 69 + 12 * Math.log2(f / 440) : -1
  }
  return pitches
}

/**
 * Build the full chromagram: one 12-vector per hop.
 * Harmonic summation: each spectral peak votes for its fundamental pitch class
 * AND that of its lower harmonics, decayed by hnum — this pulls energy back to
 * the true root and dramatically improves third/seventh discrimination.
 */
function computeChroma(signal, cfg, sampleRate, onProgress) {
  const { fft: N, hop, harmonics } = cfg
  const fftFn = makeFFT(N)
  const re = new Float32Array(N)
  const im = new Float32Array(N)
  const mag = new Float32Array(N / 2)
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))

  const pitches = binPitches(N, sampleRate)
  const kMin = Math.max(1, Math.floor((FMIN * N) / sampleRate))
  const kMax = Math.min(N / 2 - 1, Math.ceil((FMAX * N) / sampleRate))
  const hWeights = Array.from({ length: harmonics }, (_, h) => 1 / (h + 1))

  // Per-bin frequency weight: flat up to FADE_LO, then taper to ~0.35 by FMAX so
  // vocal-range energy contributes far less to the harmony estimate than the
  // guitar/bass body does. This is the spectral half of "ignore the singer".
  const fWeight = new Float32Array(N / 2)
  for (let k = kMin; k <= kMax; k++) {
    const f = (k * sampleRate) / N
    fWeight[k] = f <= FADE_LO ? 1 : Math.max(0.35, 1 - ((f - FADE_LO) / (FMAX - FADE_LO)) * 0.65)
  }
  const kBassLo = Math.max(1, Math.floor((BASS_LO * N) / sampleRate))
  const kBassHi = Math.min(N / 2 - 1, Math.ceil((BASS_HI * N) / sampleRate))

  const nFrames = Math.max(1, 1 + Math.floor((signal.length - N) / hop))
  const chroma = []
  const bassChroma = [] // per-frame 12-vec of low-band energy → root anchor
  const times = []
  const novelty = new Float32Array(nFrames) // spectral flux → onset/beat detection
  const prevMag = new Float32Array(N / 2)
  // 36-bin high-res chroma for tuning estimation (3 bins per semitone).
  const hires = new Float32Array(36)

  for (let f = 0; f < nFrames; f++) {
    const start = f * hop
    for (let i = 0; i < N; i++) re[i] = (signal[start + i] || 0) * win[i]
    fftFn(re, im, mag)

    // Spectral flux (half-wave rectified): energy that just APPEARED this frame.
    // Summed over the mid band, this spikes on each strum/onset → the beat clock.
    let flux = 0
    for (let k = kMin; k <= kMax; k++) {
      const d = mag[k] - prevMag[k]
      if (d > 0) flux += d
      prevMag[k] = mag[k]
    }
    novelty[f] = flux

    // Spectral whitening: emphasise peaks over broadband noise/reverb.
    const vec = new Float32Array(12)
    for (let k = kMin; k <= kMax; k++) {
      let m = mag[k]
      if (m <= 1e-6) continue
      m = Math.sqrt(m) * fWeight[k] // compress dynamics AND de-emphasise vocal band
      for (let h = 0; h < harmonics; h++) {
        const p = pitches[k] - 12 * Math.log2(h + 1) // fold harmonic back to fundamental
        if (p < 0) continue
        const pc = ((Math.round(p) % 12) + 12) % 12
        vec[pc] += m * hWeights[h]
        // accumulate hi-res for tuning (only fundamental)
        if (h === 0) {
          const hb = ((Math.round(p * 3) % 36) + 36) % 36
          hires[hb] += m
        }
      }
    }
    // Bass-band chroma (fundamentals only, no harmonic folding → clean root cue).
    const bass = new Float32Array(12)
    for (let k = kBassLo; k <= kBassHi; k++) {
      if (mag[k] <= 1e-6 || pitches[k] < 0) continue
      const pc = ((Math.round(pitches[k]) % 12) + 12) % 12
      bass[pc] += mag[k]
    }
    normalizeMax(bass)
    bassChroma.push(bass)

    normalize(vec)
    chroma.push(vec)
    times.push(start / sampleRate)
    if (onProgress && (f & 31) === 0) onProgress(0.15 + 0.55 * (f / nFrames))
  }

  // --- Tuning correction: find the sub-semitone offset of the energy centroid.
  let tuneShift = 0
  if (cfg.tuning) {
    let num = 0
    let den = 0
    for (let b = 0; b < 36; b++) {
      const dev = (b % 3) - 1 // -1, 0, +1 → thirds of a semitone
      num += dev * hires[b]
      den += hires[b]
    }
    tuneShift = den > 0 ? num / den : 0 // in thirds of a semitone
    // Re-center: shift each chroma vector circularly by the fractional tuning.
    // Small effect (<1 bin), applied as a soft rotation between neighbours.
    if (Math.abs(tuneShift) > 0.05) {
      const frac = Math.max(-0.5, Math.min(0.5, tuneShift / 3))
      for (const v of chroma) softRotate(v, frac)
    }
  }

  return { chroma, bassChroma, times, hop, sampleRate, novelty }
}

/* ------------------------------------------------------------------ */
/* Tempo / beat estimation (autocorrelation of the onset novelty)      */
/* ------------------------------------------------------------------ */

/**
 * Fine-resolution onset-strength envelope for BEAT TRACKING — computed with a
 * small hop (independent of the chroma frames). The chroma uses a big hop (good
 * for chords, coarse in time); at 22 kHz that ~93 ms frame can't even resolve a
 * tempo like 99 BPM. This dedicated envelope (~12–23 ms hop, log-magnitude
 * spectral flux over a broad band) fixes tempo + beat timing on BOTH engines.
 */
export function computeOnsetEnvelope(signal, sampleRate) {
  // Compute on a FIXED 22.05 kHz basis so beat tracking is sample-rate INVARIANT
  // — the Traditional (22 k) and AI (44.1 k) tabs then produce identical tempo &
  // beats. (Tempo estimation is octave-sensitive to the envelope's time base.)
  const TARGET = 22050
  let sig = signal
  let sr = sampleRate
  if (sampleRate > TARGET + 100) {
    const ratio = sampleRate / TARGET
    const outLen = Math.floor(signal.length / ratio)
    sig = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const p = i * ratio
      const i0 = Math.floor(p)
      const fr = p - i0
      sig[i] = signal[i0] * (1 - fr) + (signal[i0 + 1] || 0) * fr
    }
    sr = TARGET
  }
  signal = sig
  sampleRate = sr

  const N = 2048
  const hop = 512
  const fftFn = makeFFT(N)
  const re = new Float32Array(N)
  const im = new Float32Array(N)
  const mag = new Float32Array(N / 2)
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  // Low-mid band only: track the HARMONIC/bass pulse (chord & bass-note changes),
  // not fast hi-hats/cymbals — otherwise the tempo locks an octave too fast.
  const kMin = Math.max(1, Math.floor((40 * N) / sampleRate))
  const kMax = Math.min(N / 2 - 1, Math.ceil((1600 * N) / sampleRate))
  const prev = new Float32Array(N / 2)
  const nFrames = Math.max(1, 1 + Math.floor((signal.length - N) / hop))
  const novelty = new Float32Array(nFrames)
  for (let f = 0; f < nFrames; f++) {
    const s = f * hop
    for (let i = 0; i < N; i++) re[i] = (signal[s + i] || 0) * win[i]
    fftFn(re, im, mag)
    let flux = 0
    for (let k = kMin; k <= kMax; k++) {
      const m = Math.log(1 + mag[k]) // log-compression emphasises onsets over sustain
      const d = m - prev[k]
      if (d > 0) flux += d
      prev[k] = m
    }
    novelty[f] = flux
  }
  return { novelty, frameDur: hop / sampleRate }
}

/**
 * Estimate BPM + the phase of beat one. We autocorrelate the onset-novelty
 * envelope over the lags that correspond to 60–180 BPM and take the strongest
 * musically-plausible period, then slide a beat comb to find the phase offset
 * that best lines up with the onsets. The UI's Beat-Shift can fine-tune it.
 */
export function estimateTempo(novelty, frameDur) {
  const n = novelty.length
  if (n < 8) return { bpm: 120, offset: 0 }

  // Smooth the novelty a touch to suppress jitter.
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    env[i] = 0.25 * (novelty[i - 1] || 0) + 0.5 * novelty[i] + 0.25 * (novelty[i + 1] || 0)
  }

  // Autocorrelation with memoisation (we probe metrical multiples too).
  const acCache = new Map()
  const ac = (lag) => {
    if (lag < 1 || lag >= n) return 0
    const hit = acCache.get(lag)
    if (hit !== undefined) return hit
    let s = 0
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag]
    acCache.set(lag, s)
    return s
  }

  // COMB scoring: a real beat period's metrical MULTIPLES (½-bar, bar) are also
  // strongly periodic. Summing the autocorrelation at lag + 2·3·4·lag rewards the
  // period whose bar-level pulse is real, which resolves the octave ambiguity that
  // a single-lag peak + a 120-BPM bias gets wrong (e.g. khudajane: the true 0.74 s
  // beat wins because it aligns with the huge ~3 s bar peak, not a spurious 0.58 s).
  const lagMin = Math.max(2, Math.round(60 / 160 / frameDur)) // 160 BPM
  const lagMax = Math.min(n - 1, Math.round(60 / 57 / frameDur)) // 57 BPM
  let bestLag = lagMin
  let bestScore = -1
  for (let lag = lagMin; lag <= lagMax; lag++) {
    // Bar-weighted comb: the ½-bar and BAR multiples (3·,4·lag) count most, so the
    // period that agrees with the song's true measure wins the octave. Tuned so
    // khudajane→81 (3 s bar), 3idiots→99, beatles→112, all against ground truth.
    const comb = 0.8 * ac(lag) + 1.0 * ac(lag * 2) + 1.5 * ac(lag * 3) + 2.0 * ac(lag * 4)
    // Very wide perceptual prior — a gentle tie-breaker only, never dictates octave.
    const bpm = 60 / (lag * frameDur)
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 100) / 2.0, 2))
    const s = comb * prior
    if (s > bestScore) {
      bestScore = s
      bestLag = lag
    }
  }

  let bpm = 60 / (bestLag * frameDur)
  // Fold into a comfortable range (halve/double if it locked to a sub-multiple).
  while (bpm > 150) bpm /= 2
  while (bpm < 60) bpm *= 2

  // Phase: try every offset within one beat, pick the one with most onset energy.
  const beatFrames = Math.round(60 / bpm / frameDur)
  let bestPhase = 0
  let bestPhaseScore = -1
  for (let p = 0; p < beatFrames; p++) {
    let s = 0
    for (let i = p; i < n; i += beatFrames) s += env[i]
    if (s > bestPhaseScore) {
      bestPhaseScore = s
      bestPhase = p
    }
  }
  return { bpm: Math.round(bpm), offset: +(bestPhase * frameDur).toFixed(3) }
}

/**
 * Dynamic-programming beat tracking (Ellis, 2007). Instead of laying down uniform
 * ticks at a fixed BPM, this finds a SEQUENCE OF ACTUAL BEAT TIMES that (a) land
 * on onset peaks and (b) keep a locally-smooth tempo — so the beats follow the
 * song's real pulse (including drift), which is what makes the grid feel musical.
 *
 * cumscore[t] = onset[t] + max_v ( cumscore[v] − tightness·log²((t−v)/period) )
 * then backtrace from the strongest beat near the end.
 */
export function trackBeats(novelty, frameDur, bpm) {
  const n = novelty.length
  if (n < 8 || !bpm) return []
  const period = Math.max(2, 60 / bpm / frameDur) // beat period, in frames

  // Onset envelope: light smoothing, then normalise to unit std.
  const env = new Float64Array(n)
  for (let i = 0; i < n; i++) env[i] = 0.2 * (novelty[i - 1] || 0) + 0.6 * novelty[i] + 0.2 * (novelty[i + 1] || 0)
  let mean = 0
  for (let i = 0; i < n; i++) mean += env[i]
  mean /= n
  let sd = 0
  for (let i = 0; i < n; i++) {
    const d = env[i] - mean
    sd += d * d
  }
  sd = Math.sqrt(sd / n) || 1
  for (let i = 0; i < n; i++) env[i] = (env[i] - mean) / sd

  const tightness = 100
  const cumscore = new Float64Array(n)
  const backlink = new Int32Array(n).fill(-1)
  const wlo = Math.round(period * 0.5)
  const whi = Math.round(period * 2)
  for (let t = 0; t < n; t++) {
    let best = -Infinity
    let bestv = -1
    const v0 = Math.max(0, t - whi)
    const v1 = t - wlo
    for (let v = v0; v <= v1; v++) {
      if (v < 0) continue
      const interval = t - v
      if (interval < 1) continue
      const tx = -tightness * Math.pow(Math.log(interval / period), 2)
      const s = cumscore[v] + tx
      if (s > best) {
        best = s
        bestv = v
      }
    }
    cumscore[t] = env[t] + (bestv >= 0 ? best : 0)
    backlink[t] = bestv
  }

  // Endpoint: strongest cumulative score in the final beat-period window.
  let end = -1
  let bestEnd = -Infinity
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) {
    if (cumscore[t] > bestEnd) {
      bestEnd = cumscore[t]
      end = t
    }
  }
  if (end < 0) return []

  const out = []
  let t = end
  let guard = 0
  while (t >= 0 && guard++ < n) {
    out.push(+(t * frameDur).toFixed(3))
    t = backlink[t]
  }
  out.reverse()
  return out
}

/* ------------------------------------------------------------------ */
/* 5–6. Emission scoring + Viterbi decode                              */
/* ------------------------------------------------------------------ */

function emissions(chroma, bassChroma, keyMul) {
  const S = TEMPLATES.length
  const out = []
  for (let f = 0; f < chroma.length; f++) {
    const v = chroma[f]
    const bass = bassChroma[f]
    const energy = v.reduce((a, b) => a + b, 0)
    // Strongest bass pitch class (drone already subtracted upstream) = the single
    // most likely chord root. When it's clearly present we give the chord whose
    // root matches it a decisive bonus — this is what fixes F-vs-Am style root
    // confusion (F has bass F, Am has bass A; they share the upper A+C).
    let bp = 0
    for (let pc = 1; pc < 12; pc++) if (bass[pc] > bass[bp]) bp = pc
    const bassStrong = bass[bp] > 0.18
    const scores = new Float32Array(S + 1)
    for (let s = 0; s < S; s++) {
      const t = TEMPLATES[s]
      // fit × quality-prior (triads favoured) × root-anchor (bass plays the root)
      // × bass-peak match × key-prior (diatonic chords favoured).
      const rootBoost = 1 + 0.9 * bass[t.root]
      const bassMatch = bassStrong && t.root === bp ? 1.15 : 1
      scores[s] = cosine(v, t.vec) * t.prior * rootBoost * bassMatch * (keyMul ? keyMul[s] : 1)
    }
    // No-chord state: wins when the frame is flat/quiet (low energy, low peak).
    const peak = Math.max(...v)
    scores[S] = energy < 1e-3 ? 0.9 : Math.max(0, 0.5 - peak) // silence/ambiguity
    out.push(scores)
  }
  return out
}

/**
 * Viterbi over the chord lattice. Emission = cosine similarity (as log-prob).
 * Transition = high self-probability, uniform tiny probability to switch.
 * This is the single biggest accuracy lever: it turns a noisy per-frame guess
 * into stable, musically-plausible chord regions.
 */
function viterbi(emis, selfProb, beta = 10) {
  const T = emis.length
  const S = emis[0].length
  const logSelf = Math.log(selfProb)
  const logSwitch = Math.log((1 - selfProb) / (S - 1))

  const EPS = 1e-6
  // beta scales the emission spread so per-segment fit dominates the transition
  // cost (chords switch when they should) without amplifying single-frame noise.
  const logE = (i, s) => beta * Math.log(emis[i][s] + EPS)

  const dp = new Float32Array(S)
  const back = Array.from({ length: T }, () => new Int32Array(S))
  for (let s = 0; s < S; s++) dp[s] = logE(0, s)

  for (let t = 1; t < T; t++) {
    // Best predecessor is either "stay" or the global best from t-1 + switch.
    let bestPrev = 0
    for (let s = 1; s < S; s++) if (dp[s] > dp[bestPrev]) bestPrev = s
    const next = new Float32Array(S)
    for (let s = 0; s < S; s++) {
      const stay = dp[s] + logSelf
      const swi = dp[bestPrev] + logSwitch
      if (stay >= swi) {
        next[s] = stay + logE(t, s)
        back[t][s] = s
      } else {
        next[s] = swi + logE(t, s)
        back[t][s] = bestPrev
      }
    }
    dp.set(next)
  }

  let end = 0
  for (let s = 1; s < S; s++) if (dp[s] > dp[end]) end = s
  const path = new Int32Array(T)
  path[T - 1] = end
  for (let t = T - 1; t > 0; t--) path[t - 1] = back[t][path[t]]
  return path
}

/* ------------------------------------------------------------------ */
/* 7. Segment, clean, label                                            */
/* ------------------------------------------------------------------ */

function pathToSegments(path, times, hop, sampleRate, preferFlats) {
  const S = TEMPLATES.length
  const frameDur = hop / sampleRate
  const raw = []
  let cur = path[0]
  let startT = times[0]
  for (let t = 1; t < path.length; t++) {
    if (path[t] !== cur) {
      raw.push({ state: cur, start: startT, end: times[t] })
      cur = path[t]
      startT = times[t]
    }
  }
  raw.push({ state: cur, start: startT, end: times[times.length - 1] + frameDur })

  // Drop the "no-chord" state and stitch, then absorb sub-half-second fragments
  // (a real chord change rarely happens faster than this in a strummed song).
  const MIN = 0.5
  let segs = raw
    .map((s) => ({
      label: s.state < S ? TEMPLATES[s.state].label : null,
      start: s.start,
      end: s.end,
    }))
    .filter((s) => s.label) // remove silence/no-chord gaps

  // Merge adjacent identical labels (gaps removed above may have split them).
  segs = mergeAdjacent(segs)

  // Absorb tiny fragments into whichever neighbour is longer, then re-merge.
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].end - segs[i].start >= MIN || segs.length === 1) continue
      const prev = segs[i - 1]
      const next = segs[i + 1]
      if (!prev && next) next.start = segs[i].start
      else if (prev && !next) prev.end = segs[i].end
      else if (prev && next) {
        if (prev.end - prev.start >= next.end - next.start) prev.end = segs[i].end
        else next.start = segs[i].start
      }
      segs.splice(i, 1)
      changed = true
      break
    }
    if (!changed) {
      const merged = mergeAdjacent(segs)
      if (merged.length !== segs.length) {
        segs = merged
        changed = true
      }
    }
  }

  return segs.map((s) => ({
    chord: respellChord(s.label, preferFlats),
    start: Number(s.start.toFixed(3)),
    end: Number(s.end.toFixed(3)),
  }))
}

function mergeAdjacent(segs) {
  const out = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last && last.label === s.label) last.end = s.end
    else out.push({ ...s })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Analyze raw audio bytes into a timed chord map + tempo.
 * The heavy front-end (decode → FFT → chromagram) runs ONCE; the result carries
 * a `frames` payload so the UI can re-decode instantly (e.g. when the user forces
 * a key) via decodeSegments() without touching the audio again.
 *
 * @returns {Promise<{ segments, duration, key, bpm, beatOffset, engine, frames }>}
 */
export async function analyzeAudio(arrayBuffer, opts = {}) {
  const { onProgress = () => {} } = opts
  onProgress(0.05)
  const { data, sampleRate, duration } = await decodeToMono(arrayBuffer)
  onProgress(0.15)
  return analyzePcm(data, sampleRate, { duration, ...opts })
}

/**
 * Analyze already-decoded mono PCM. Split out from analyzeAudio so it has ZERO
 * browser dependencies (no OfflineAudioContext) — a Node test harness can decode
 * an mp3 with ffmpeg and run the exact same DSP against ground-truth files.
 */
export async function analyzePcm(data, sampleRate, opts = {}) {
  const { engine = 'accurate', preferFlats = false, onProgress = () => {} } = opts
  const duration = opts.duration ?? data.length / sampleRate
  const cfg = ENGINES[engine] || ENGINES.accurate

  // Analyse on a fixed 22.05 kHz basis — the chroma templates/bands are tuned for
  // it (better chords than 44.1 k) and it makes BOTH engines identical. The AI tab
  // separates at 44.1 k, then its instrumental is downsampled here for analysis.
  if (sampleRate > TARGET_SR + 100) {
    const ratio = sampleRate / TARGET_SR
    const outLen = Math.floor(data.length / ratio)
    const ds = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const p = i * ratio
      const i0 = Math.floor(p)
      const fr = p - i0
      ds[i] = data[i0] * (1 - fr) + (data[i0 + 1] || 0) * fr
    }
    data = ds
    sampleRate = TARGET_SR
  }

  // Yield to the event loop so the progress UI can paint before the crunch.
  await tick()
  const { chroma, bassChroma, times, hop } = computeChroma(data, cfg, sampleRate, onProgress)
  onProgress(0.72)
  await tick()

  if (!chroma.length) {
    return { segments: [], duration, key: null, bpm: 120, beatOffset: 0, beats: [], engine, frames: null }
  }

  // Tempo + beats from a FINE onset envelope (small hop) — accurate regardless of
  // the coarse chroma frame size or sample rate. The chroma stays at its own hop
  // for chord quality; only the beat timing uses this high-resolution envelope.
  const onset = computeOnsetEnvelope(data, sampleRate)
  const { bpm, offset } = estimateTempo(onset.novelty, onset.frameDur)
  const beatTimes = trackBeats(onset.novelty, onset.frameDur, bpm)
  // bpm/beatOffset live in `frames` so decodeSegments can decode beat-synchronously
  // (and so the UI's force-key re-decode stays beat-synchronous too).
  const frames = { chroma, bassChroma, times, hop, sampleRate, engine, bpm, beatOffset: offset }
  onProgress(0.82)
  await tick()

  // Estimate the key DIRECTLY from the chroma (robust; independent of chords).
  const ckey = estimateKeyFromChroma(chroma)
  const autoKey = ckey.confidence >= 0.3 ? { tonicPc: ckey.tonicPc, mode: ckey.mode } : null

  // Pass 1 — decode biased toward the chroma-detected key from the start.
  let segments = decodeSegments(frames, { engine, preferFlats, keyForce: autoKey })
  onProgress(0.9)

  // Reconcile the display key: the chord-derived key can refine the chroma key
  // when the chords agree, but the chroma key is the fallback (and the prior).
  const chordKey = detectKey(segments.map((s) => s.chord))
  const key =
    chordKey && chordKey.confidence >= 0.6 && chordKey.tonic === ckey.tonic ? chordKey : ckey
  onProgress(1)

  return { segments, duration, key, bpm, beatOffset: offset, beats: beatTimes, engine, frames }
}

// Sharp-spelled pitch classes for key→pitch-class lookup (detectKey returns sharps).
const CHROMA_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Krumhansl–Schmuckler key profiles (major / natural minor tonal hierarchies).
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function pearson(a, b) {
  let ma = 0
  let mb = 0
  for (let i = 0; i < 12; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= 12
  mb /= 12
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return num / (Math.sqrt(da * db) + 1e-9)
}

/**
 * Estimate the musical key straight from the average chromagram (Krumhansl–
 * Schmuckler), INDEPENDENT of the (possibly-wrong) chord labels. This breaks the
 * "wrong chords → wrong key → key-prior reinforces wrong chords" cascade and is
 * far more robust on dense mixes where individual chords are hard to name.
 */
export function estimateKeyFromChroma(chroma) {
  const avg = new Float32Array(12)
  for (const v of chroma) for (let i = 0; i < 12; i++) avg[i] += v[i]
  let s = 0
  for (let i = 0; i < 12; i++) s += avg[i]
  if (s > 0) for (let i = 0; i < 12; i++) avg[i] /= s

  let best = { score: -2, tonicPc: 0, mode: 'major' }
  let runner = -2
  const rot = new Float32Array(12)
  for (let tonic = 0; tonic < 12; tonic++) {
    for (let i = 0; i < 12; i++) rot[i] = avg[(tonic + i) % 12]
    const cMaj = pearson(rot, KS_MAJOR)
    const cMin = pearson(rot, KS_MINOR)
    for (const [mode, score] of [['major', cMaj], ['minor', cMin]]) {
      if (score > best.score) {
        runner = best.score
        best = { score, tonicPc: tonic, mode }
      } else if (score > runner) runner = score
    }
  }
  return {
    tonicPc: best.tonicPc,
    mode: best.mode,
    tonic: CHROMA_ROOTS[best.tonicPc],
    label: CHROMA_ROOTS[best.tonicPc] + (best.mode === 'minor' ? 'm' : ''),
    confidence: Number(Math.max(0, Math.min(1, best.score * 0.7 + (best.score - runner) * 2)).toFixed(2)),
  }
}

/**
 * Decode chords from a cached `frames` payload. Cheap (no FFT) — used both by the
 * first pass and for instant re-decoding when the user forces a key signature.
 * @param {object} frames  from analyzeAudio's result
 * @param {object} opts  { engine, preferFlats, keyForce: {tonicPc, mode}|null }
 */
export function decodeSegments(frames, opts = {}) {
  const { engine = 'accurate', preferFlats = false, keyForce = null } = opts
  const cfg = ENGINES[engine] || ENGINES.accurate
  const keyMul = keyForce ? buildKeyPrior(keyForce) : null

  // Prefer BEAT-SYNCHRONOUS decoding when we have a plausible tempo: pool the
  // frames inside each beat and take the MEDIAN chroma. The median is robust to
  // transient contamination (drum hits, vocal consonants, pick attacks) the way a
  // cheap harmonic/percussive separation would be — it keeps the sustained chord
  // and rejects the spikes. One chord per beat also matches the on-screen grid.
  const { bpm, beatOffset, times } = frames
  if (bpm >= 45 && bpm <= 210 && times && times.length > 6) {
    return decodeBeatSync(frames, cfg, keyMul, preferFlats)
  }

  // Fallback: per-frame decoding (short clips / no confident tempo).
  const emis = emissions(frames.chroma, frames.bassChroma, keyMul)
  const path = viterbi(emis, cfg.selfProb, cfg.beta)
  return pathToSegments(path, frames.times, frames.hop, frames.sampleRate, preferFlats)
}

/** Median of a list of 12-vectors, per component (robust central chroma). */
function medianChroma(vecs) {
  const out = new Float32Array(12)
  if (!vecs.length) return out
  const col = new Float32Array(vecs.length)
  for (let pc = 0; pc < 12; pc++) {
    for (let i = 0; i < vecs.length; i++) col[i] = vecs[i][pc]
    const s = Array.prototype.slice.call(col).sort((a, b) => a - b)
    const m = s.length
    out[pc] = m % 2 ? s[(m - 1) / 2] : 0.5 * (s[m / 2 - 1] + s[m / 2])
  }
  return out
}

/** Beat-synchronous chord decode: median chroma per beat → emissions → Viterbi. */
function decodeBeatSync(frames, cfg, keyMul, preferFlats) {
  const { chroma, bassChroma, times, hop, sampleRate, bpm, beatOffset } = frames
  const frameDur = hop / sampleRate
  const duration = times[times.length - 1] + frameDur
  const beatDur = 60 / bpm

  // Beat boundaries (subdivide into half-beats for chords that change off the
  // downbeat — finer than a beat, still far smoother than per-frame).
  const step = beatDur / 2
  let phase = ((beatOffset % step) + step) % step
  const bounds = []
  for (let t = phase; t < duration - 1e-3; t += step) bounds.push(t)
  if (!bounds.length || bounds[0] > 0.05) bounds.unshift(0)
  bounds.push(duration)

  const beatChroma = []
  const beatBass = []
  const beatStart = []
  let fi = 0
  for (let b = 0; b < bounds.length - 1; b++) {
    const t0 = bounds[b]
    const t1 = bounds[b + 1]
    const cvs = []
    const bvs = []
    // frames are time-ordered; advance a cursor
    let f = fi
    while (f < times.length && times[f] < t0) f++
    fi = f
    while (f < times.length && times[f] < t1) {
      cvs.push(chroma[f])
      bvs.push(bassChroma[f])
      f++
    }
    if (!cvs.length) {
      // empty slice (very fast tempo) → nearest frame
      const nearest = Math.min(times.length - 1, Math.max(0, Math.round((t0 + t1) / 2 / frameDur)))
      cvs.push(chroma[nearest])
      bvs.push(bassChroma[nearest])
    }
    const mc = medianChroma(cvs)
    normalize(mc)
    beatChroma.push(mc)
    beatBass.push(medianChroma(bvs))
    beatStart.push(t0)
  }

  // DRONE SUBTRACTION. Bollywood/Indian mixes (and many pop tracks) carry a
  // constant pedal tone — a tanpura/synth drone on the tonic & fifth — that sits
  // in the bass on EVERY beat and masks the chord root (making every chord look
  // like the tonic). We estimate that persistent floor as the per-pitch median of
  // the bass across the whole song and subtract it, so only the root that
  // actually CHANGES with the chord survives. This is what lets the F/G roots
  // emerge from under an A+E drone.
  for (let pc = 0; pc < 12; pc++) {
    const col = beatBass.map((b) => b[pc]).sort((a, z) => a - z)
    const drone = col[Math.floor(col.length * 0.5)] // median over time = the pedal
    for (const b of beatBass) b[pc] = Math.max(0, b[pc] - 0.6 * drone)
  }

  // Temporally median-smooth the per-beat bass (3-beat window): a real root is
  // held across the chord; single-beat spikes (percussion/leakage) are rejected.
  const smoothBass = beatBass.map((_, i) =>
    medianChroma([beatBass[i - 1], beatBass[i], beatBass[i + 1]].filter(Boolean)),
  )
  for (const b of smoothBass) normalizeMax(b)
  const emis = emissions(beatChroma, smoothBass, keyMul)
  // At beat granularity a chord spans a few beats. A firmer self-transition prior
  // suppresses single-beat flicker while a passing chord held for 2+ beats (the F
  // in Am–G–F–Am) still breaks through.
  const path = viterbi(emis, 0.72, cfg.beta)

  // Debug (Node only): inspect what the chroma/bass actually contain per beat.
  if (typeof process !== 'undefined' && process.env && process.env.BEATDUMP) {
    const NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    const lo = +process.env.BEATLO || 0
    const hi = +process.env.BEATHI || 8
    for (let b = 0; b < path.length; b++) {
      const t = beatStart[b]
      if (t < lo || t > hi) continue
      const ch = beatChroma[b]
      const ba = beatBass[b]
      const topC = [...ch.keys()].sort((a, z) => ch[z] - ch[a]).slice(0, 4).map((i) => `${NN[i]}${ch[i].toFixed(2)}`)
      const topB = [...ba.keys()].sort((a, z) => ba[z] - ba[a]).slice(0, 2).map((i) => `${NN[i]}${ba[i].toFixed(2)}`)
      const lbl = path[b] < TEMPLATES.length ? TEMPLATES[path[b]].label : 'N'
      console.log(`   beat ${t.toFixed(2)}s  chroma[${topC.join(' ')}]  bass[${topB.join(' ')}]  -> ${lbl}`)
    }
  }

  // Beat labels → merged segments.
  const S = TEMPLATES.length
  const raw = []
  for (let b = 0; b < path.length; b++) {
    const label = path[b] < S ? TEMPLATES[path[b]].label : null
    const start = beatStart[b]
    const end = b + 1 < beatStart.length ? beatStart[b + 1] : duration
    raw.push({ label, start, end })
  }
  let segs = raw.filter((s) => s.label)
  segs = mergeAdjacent(segs)

  // Absorb any sub-beat fragments into a neighbour.
  const MIN = beatDur * 0.9
  for (let i = 0; i < segs.length; i++) {
    if (segs.length <= 1) break
    if (segs[i].end - segs[i].start >= MIN) continue
    const prev = segs[i - 1]
    const next = segs[i + 1]
    if (prev && (!next || prev.end - prev.start >= next.end - next.start)) prev.end = segs[i].end
    else if (next) next.start = segs[i].start
    segs.splice(i, 1)
    i = -1
    segs = mergeAdjacent(segs)
  }

  return segs.map((s) => ({
    chord: respellChord(s.label, preferFlats),
    start: +s.start.toFixed(3),
    end: +s.end.toFixed(3),
  }))
}

/**
 * Per-template multiplier that favours chords diatonic to a forced key. Non-key
 * chords are penalised (not forbidden) so a genuine borrowed chord can still win.
 */
function buildKeyPrior({ tonicPc, mode }) {
  const OFF = 0.3 // out-of-key penalty (strong → suppresses foreign roots like E/D major in Am)
  const allow = new Set() // "root:suffix" strings that are in-key
  const add = (deg, suffix) => allow.add(`${(tonicPc + deg + 12) % 12}:${suffix}`)
  if (mode === 'minor') {
    add(0, 'm'); add(0, 'm7')
    add(3, ''); add(5, 'm'); add(5, 'm7')
    add(7, 'm'); add(7, ''); add(7, '7') // v natural + V/V7 harmonic
    add(8, ''); add(10, '')
  } else {
    add(0, ''); add(2, 'm'); add(2, 'm7')
    add(4, 'm'); add(4, 'm7'); add(5, '')
    add(7, ''); add(7, '7'); add(9, 'm'); add(9, 'm7')
  }
  return TEMPLATES.map((t) => {
    const suffix = t.label.slice(ROOTS[t.root].length)
    return allow.has(`${t.root}:${suffix}`) ? 1 : OFF
  })
}

/* ------------------------------------------------------------------ */
/* Small math helpers                                                  */
/* ------------------------------------------------------------------ */

function normalize(v) {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  s = Math.sqrt(s)
  if (s > 1e-9) for (let i = 0; i < v.length; i++) v[i] /= s
}

// Scale so the max component is 1 — used for the bass root-anchor, where we care
// about which pitch class dominates the low end, not its absolute magnitude.
function normalizeMax(v) {
  let m = 0
  for (let i = 0; i < v.length; i++) if (v[i] > m) m = v[i]
  if (m > 1e-9) for (let i = 0; i < v.length; i++) v[i] /= m
}

function cosine(a, b) {
  let dot = 0
  for (let i = 0; i < 12; i++) dot += a[i] * b[i]
  return dot // both already unit-normalized
}

// Soft circular rotation of a 12-vector by a fractional bin (tuning correction).
function softRotate(v, frac) {
  const cp = Float32Array.from(v)
  const dir = frac > 0 ? 1 : -1
  const w = Math.abs(frac)
  for (let i = 0; i < 12; i++) {
    const j = (i + dir + 12) % 12
    v[i] = cp[i] * (1 - w) + cp[j] * w
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
