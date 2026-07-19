/**
 * separation.js — on-device vocal / instrument stem separation (Phase 1B).
 *
 * Pipeline:  audio → STFT → [U-Net soft-mask model, ONNX Runtime Web] → apply
 *            mask → ISTFT → instrumental (+ vocal) stems.  The instrumental stem
 *            is then fed to the chroma DSP so chords are read from the backing
 *            track instead of the vocal-masked mix.
 *
 * The STFT/ISTFT here are exact and self-contained (verified by a reconstruction
 * roundtrip in scripts/test-separation.mjs). The model is loaded lazily from a
 * configurable URL via ONNX Runtime Web (WASM/WebGPU) — no server, no key.
 *
 * Model contract (Spleeter/Open-Unmix-style magnitude mask):
 *   input : Float32 magnitude spectrogram, shape [1, 1, frames, freqBins]
 *   output: Float32 soft mask in [0,1] for the INSTRUMENTAL, same shape
 * Adapt runMask() to a specific model's exact I/O names & shapes.
 */

const FFT = 4096
const HOP = 1024 // 75% overlap — Hann COLA-compatible

/* ------------------------------------------------------------------ */
/* Complex FFT (iterative radix-2, forward & inverse)                  */
/* ------------------------------------------------------------------ */
function makeComplexFFT(n) {
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
  // In-place. inverse=true conjugates twiddles and scales by 1/n.
  return function fft(re, im, inverse) {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const ti = k * step
          const c = cos[ti]
          const s = inverse ? -sin[ti] : sin[ti]
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
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n
        im[i] /= n
      }
    }
  }
}

function hann(n) {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

/* ------------------------------------------------------------------ */
/* STFT / ISTFT                                                        */
/* ------------------------------------------------------------------ */

/** Forward STFT → per-frame complex spectra (full N bins). */
export function stft(signal, fftSize = FFT, hop = HOP) {
  const fft = makeComplexFFT(fftSize)
  const win = hann(fftSize)
  const nFrames = Math.max(1, 1 + Math.ceil((signal.length - fftSize) / hop))
  const re = []
  const im = []
  const fr = new Float32Array(fftSize)
  const fi = new Float32Array(fftSize)
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop
    for (let i = 0; i < fftSize; i++) {
      fr[i] = (signal[start + i] || 0) * win[i]
      fi[i] = 0
    }
    fft(fr, fi, false)
    re.push(Float32Array.from(fr))
    im.push(Float32Array.from(fi))
  }
  return { re, im, fftSize, hop, length: signal.length, nFrames }
}

/** Inverse STFT (weighted overlap-add with Hann COLA normalisation). */
export function istft({ re, im, fftSize = FFT, hop = HOP, length }) {
  const fft = makeComplexFFT(fftSize)
  const win = hann(fftSize)
  const outLen = length || (re.length - 1) * hop + fftSize
  const out = new Float32Array(outLen)
  const norm = new Float32Array(outLen)
  const fr = new Float32Array(fftSize)
  const fi = new Float32Array(fftSize)
  for (let f = 0; f < re.length; f++) {
    fr.set(re[f])
    fi.set(im[f])
    fft(fr, fi, true) // → time domain (real part)
    const start = f * hop
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i
      if (idx >= outLen) break
      out[idx] += fr[i] * win[i]
      norm[idx] += win[i] * win[i]
    }
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-8) out[i] /= norm[i]
  return out
}

/** Per-frame magnitude spectrogram (first fftSize/2+1 bins). */
export function magnitude({ re, im, fftSize = FFT }) {
  const bins = fftSize / 2 + 1
  return re.map((r, f) => {
    const m = new Float32Array(bins)
    for (let k = 0; k < bins; k++) m[k] = Math.hypot(r[k], im[f][k])
    return m
  })
}

/* ------------------------------------------------------------------ */
/* ONNX Runtime Web — model loader + soft-mask separation             */
/* ------------------------------------------------------------------ */

let ortModule = null
async function ort() {
  if (!ortModule) {
    const m = await import('onnxruntime-web')
    // ORT needs its OWN wasm runtime files (ort-wasm-*.wasm). Vite doesn't bundle
    // them, so requests fell back to index.html → "expected magic word … found
    // <!do…". Serve them from the version-matched CDN instead. Single-threaded
    // avoids the SharedArrayBuffer / COOP-COEP requirement (no server headers).
    m.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'
    m.env.wasm.numThreads = 1
    ortModule = m
  }
  return ortModule
}

// UVR-MDX-NET-Inst_HQ_3 — outputs the INSTRUMENTAL stem directly. Fetched from
// the Hugging Face CDN on first use and cached by the browser (66 MB). Inference
// runs 100% on-device via ONNX Runtime Web. Verified in scripts/test-separation-full.mjs.
export const MODEL_URL =
  'https://huggingface.co/seanghay/uvr_models/resolve/main/UVR-MDX-NET-Inst_HQ_3.onnx'
let sessionCache = null

export function hasSeparationModel() {
  return !!MODEL_URL
}

/* ------------------------------------------------------------------ */
/* Off-main-thread separation (keeps the UI responsive)                */
/* ------------------------------------------------------------------ */
let sepWorker = null

/**
 * Separate the instrumental in a Web Worker so the STFT + ONNX inference + ISTFT
 * never block the UI thread. Reports progress via onProgress(phase, p) where
 * phase is 'model' (download) or 'separate' (inference). Returns a Float32Array.
 */
export function separateInWorker(audio, { onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    if (!sepWorker) {
      sepWorker = new Worker(new URL('./sepWorker.js', import.meta.url), { type: 'module' })
    }
    const w = sepWorker
    const handler = (e) => {
      const m = e.data
      if (m.type === 'progress') onProgress(m.phase, m.p)
      else if (m.type === 'done') {
        w.removeEventListener('message', handler)
        resolve(m.instrumental)
      } else if (m.type === 'error') {
        w.removeEventListener('message', handler)
        reject(new Error(m.message))
      }
    }
    w.addEventListener('message', handler)
    // structured-clone a COPY so the caller keeps its data for a raw-mix fallback
    const copy = audio.slice()
    w.postMessage({ audio: copy }, [copy.buffer])
  })
}

/** Load (and cache) the separation session. Returns null if no model is set. */
export async function getSeparationSession(onProgress = () => {}) {
  if (sessionCache) return sessionCache
  if (!MODEL_URL) return null
  sessionCache = await loadSeparationModel(MODEL_URL, onProgress)
  return sessionCache
}

/** Decode file bytes → mono Float32 at `sampleRate` (browser OfflineAudioContext). */
export async function decodeMono(arrayBuffer, sampleRate = 44100) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext
  const tmp = new OAC(1, 1, 44100)
  const audio = await tmp.decodeAudioData(arrayBuffer.slice(0))
  const L = audio.getChannelData(0)
  const mono = new Float32Array(L.length)
  if (audio.numberOfChannels > 1) {
    const R = audio.getChannelData(1)
    for (let i = 0; i < L.length; i++) mono[i] = 0.5 * (L[i] + R[i])
  } else mono.set(L)
  if (Math.abs(audio.sampleRate - sampleRate) < 1) return { data: mono, sampleRate: audio.sampleRate }
  const ratio = audio.sampleRate / sampleRate
  const outLen = Math.floor(mono.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const p = i * ratio
    const i0 = Math.floor(p)
    const fr = p - i0
    out[i] = mono[i0] * (1 - fr) + (mono[i0 + 1] || 0) * fr
  }
  return { data: out, sampleRate }
}

/**
 * Load a separation model with download progress. `url` points to a soft-mask
 * U-Net .onnx (Spleeter 2-stems / Open-Unmix / UVR-lite). Returns an ORT session.
 */
export async function loadSeparationModel(url, onProgress = () => {}) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Model fetch failed (${res.status})`)
  const total = +res.headers.get('content-length') || 0
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    if (total) onProgress(got / total)
  }
  const bytes = new Uint8Array(got)
  let off = 0
  for (const c of chunks) {
    bytes.set(c, off)
    off += c.length
  }
  const { InferenceSession } = await ort()
  return InferenceSession.create(bytes, { executionProviders: ['wasm'] })
}

/**
 * Run the model over the magnitude spectrogram → per-bin soft mask for the
 * INSTRUMENTAL. Adapt input/output tensor names + shapes to the chosen model.
 */
async function runMask(session, mag) {
  const { Tensor } = await ort()
  const frames = mag.length
  const bins = mag[0].length
  const flat = new Float32Array(frames * bins)
  for (let f = 0; f < frames; f++) flat.set(mag[f], f * bins)
  const input = new Tensor('float32', flat, [1, 1, frames, bins])
  const feeds = { [session.inputNames[0]]: input }
  const out = await session.run(feeds)
  const maskData = out[session.outputNames[0]].data
  // reshape back to [frames][bins]
  const mask = []
  for (let f = 0; f < frames; f++) mask.push(maskData.subarray(f * bins, (f + 1) * bins))
  return mask
}

/**
 * Separate an instrumental stem from mono `signal`.
 * If `session` is null, returns the original signal unchanged (identity) — this
 * keeps the whole pipeline runnable/testable before the model asset is present.
 */
export async function separate(signal, { session = null, onProgress = () => {} } = {}) {
  // No model → identity (analyse the raw mix, and the caller says so).
  if (!session) {
    onProgress(1)
    return { instrumental: signal, usedModel: false }
  }
  // Real separation via the UVR MDX-Net pipeline (mono @ 44.1 kHz in/out).
  const { mdxSeparate } = await import('./mdx.js')
  const instrumental = await mdxSeparate(signal, session, await ort(), onProgress)
  return { instrumental, usedModel: true }
}
