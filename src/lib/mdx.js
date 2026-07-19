/**
 * mdx.js — UVR MDX-Net vocal/instrument separation front-end.
 *
 * Model: UVR-MDX-NET-Inst_HQ_3 (outputs the INSTRUMENTAL stem directly).
 *   input/output tensor: [1, 4, dim_f=3072, dim_t=256]
 *     4 channels = stereo × {real, imag}; here we feed MONO duplicated to L/R.
 *   STFT params: n_fft=6144, hop=1024, center=True, periodic Hann, no norm.
 *
 * n_fft=6144 is NOT a power of two, so we use a mixed-radix FFT (3 × 2048).
 */

const N_FFT = 6144
const HOP = 1024
const DIM_F = 3072
const DIM_T = 256
const M = 2048 // radix-2 sub-size (N_FFT = 3 * M)

/* ---- radix-2 forward FFT (in-place, no scaling) ------------------- */
function makeRadix2(m) {
  const cos = new Float64Array(m / 2)
  const sin = new Float64Array(m / 2)
  for (let i = 0; i < m / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / m)
    sin[i] = Math.sin((-2 * Math.PI * i) / m)
  }
  const rev = new Uint32Array(m)
  const bits = Math.log2(m)
  for (let i = 0; i < m; i++) {
    let x = i
    let r = 0
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1)
      x >>= 1
    }
    rev[i] = r
  }
  return function (re, im) {
    for (let i = 0; i < m; i++) {
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
    for (let size = 2; size <= m; size <<= 1) {
      const half = size >> 1
      const step = m / size
      for (let i = 0; i < m; i += size) {
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
  }
}

/* ---- mixed-radix 6144 = 3 × 2048 (forward, no scaling) ------------ */
function makeFFT6144() {
  const r2 = makeRadix2(M)
  const wr = new Float64Array(N_FFT)
  const wi = new Float64Array(N_FFT)
  for (let j = 0; j < N_FFT; j++) {
    wr[j] = Math.cos((-2 * Math.PI * j) / N_FFT)
    wi[j] = Math.sin((-2 * Math.PI * j) / N_FFT)
  }
  const re0 = new Float64Array(M)
  const im0 = new Float64Array(M)
  const re1 = new Float64Array(M)
  const im1 = new Float64Array(M)
  const re2 = new Float64Array(M)
  const im2 = new Float64Array(M)
  return function forward(re, im) {
    for (let k = 0; k < M; k++) {
      re0[k] = re[3 * k]
      im0[k] = im[3 * k]
      re1[k] = re[3 * k + 1]
      im1[k] = im[3 * k + 1]
      re2[k] = re[3 * k + 2]
      im2[k] = im[3 * k + 2]
    }
    r2(re0, im0)
    r2(re1, im1)
    r2(re2, im2)
    for (let j = 0; j < N_FFT; j++) {
      const k = j % M
      const t1r = wr[j]
      const t1i = wi[j]
      const j2 = (2 * j) % N_FFT
      const t2r = wr[j2]
      const t2i = wi[j2]
      const a1r = re1[k] * t1r - im1[k] * t1i
      const a1i = re1[k] * t1i + im1[k] * t1r
      const a2r = re2[k] * t2r - im2[k] * t2i
      const a2i = re2[k] * t2i + im2[k] * t2r
      re[j] = re0[k] + a1r + a2r
      im[j] = im0[k] + a1i + a2i
    }
  }
}

const fwd = makeFFT6144()

// forward FFT of length 6144 (in place)
export function fft6144(re, im) {
  fwd(re, im)
}
// inverse via conjugation: ifft(X) = conj(fft(conj(X))) / N
export function ifft6144(re, im) {
  for (let i = 0; i < N_FFT; i++) im[i] = -im[i]
  fwd(re, im)
  for (let i = 0; i < N_FFT; i++) {
    re[i] = re[i] / N_FFT
    im[i] = -im[i] / N_FFT
  }
}

/* ---- periodic Hann window --------------------------------------- */
const WIN = (() => {
  const w = new Float64Array(N_FFT)
  for (let i = 0; i < N_FFT; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N_FFT))
  return w
})()

/* ---- MDX STFT / ISTFT (center=True, reflect pad) ----------------- */
// Returns { re:[frames][DIM_F], im:[frames][DIM_F], frames, length }
export function mdxStft(signal) {
  const pad = N_FFT / 2
  const L = signal.length
  const padded = new Float64Array(L + 2 * pad)
  for (let i = 0; i < pad; i++) padded[i] = signal[pad - i] || 0 // reflect
  for (let i = 0; i < L; i++) padded[pad + i] = signal[i]
  for (let i = 0; i < pad; i++) padded[pad + L + i] = signal[L - 2 - i] || 0
  const frames = 1 + Math.floor((padded.length - N_FFT) / HOP)
  const re = []
  const im = []
  const fr = new Float64Array(N_FFT)
  const fi = new Float64Array(N_FFT)
  for (let f = 0; f < frames; f++) {
    const s = f * HOP
    for (let i = 0; i < N_FFT; i++) {
      fr[i] = padded[s + i] * WIN[i]
      fi[i] = 0
    }
    fft6144(fr, fi)
    re.push(Float32Array.from(fr.subarray(0, DIM_F)))
    im.push(Float32Array.from(fi.subarray(0, DIM_F)))
  }
  return { re, im, frames, length: L }
}

export function mdxIstft({ re, im, length }) {
  const pad = N_FFT / 2
  const outLen = length + 2 * pad
  const out = new Float64Array(outLen)
  const norm = new Float64Array(outLen)
  const fr = new Float64Array(N_FFT)
  const fi = new Float64Array(N_FFT)
  for (let f = 0; f < re.length; f++) {
    for (let k = 0; k < N_FFT; k++) {
      fr[k] = 0
      fi[k] = 0
    }
    // fill 0..DIM_F-1, mirror hermitian for DIM_F..N_FFT-1
    for (let k = 0; k < DIM_F; k++) {
      fr[k] = re[f][k]
      fi[k] = im[f][k]
    }
    for (let k = 1; k < N_FFT - DIM_F + 1 && k < N_FFT; k++) {
      const src = k
      const dst = N_FFT - k
      if (src < DIM_F && dst >= DIM_F) {
        fr[dst] = re[f][src]
        fi[dst] = -im[f][src]
      }
    }
    ifft6144(fr, fi)
    const s = f * HOP
    for (let i = 0; i < N_FFT; i++) {
      const idx = s + i
      if (idx >= outLen) break
      out[idx] += fr[i] * WIN[i]
      norm[idx] += WIN[i] * WIN[i]
    }
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-8) out[i] /= norm[i]
  return Float32Array.from(out.subarray(pad, pad + length))
}

/* ---- full separation --------------------------------------------- */
/**
 * Separate the instrumental stem from a MONO 44.1kHz signal using the MDX model.
 * @param {Float32Array} signal  mono @ 44100
 * @param {object} session  ORT session (web or node)
 * @param {object} ort  the ORT module (for Tensor)
 */
export async function mdxSeparate(signal, session, ort, onProgress = () => {}) {
  const spec = mdxStft(signal)
  const frames = spec.frames
  const outRe = spec.re.map(() => new Float32Array(DIM_F))
  const outIm = spec.im.map(() => new Float32Array(DIM_F))

  const nChunks = Math.ceil(frames / DIM_T)
  const buf = new Float32Array(4 * DIM_F * DIM_T)
  for (let c = 0; c < nChunks; c++) {
    const f0 = c * DIM_T
    buf.fill(0)
    // layout [4, DIM_F, DIM_T]: ch0=re(L), ch1=im(L), ch2=re(R), ch3=im(R); mono→L=R
    for (let t = 0; t < DIM_T; t++) {
      const f = f0 + t
      if (f >= frames) break
      const r = spec.re[f]
      const im = spec.im[f]
      for (let k = 0; k < DIM_F; k++) {
        const base = k * DIM_T + t
        buf[0 * DIM_F * DIM_T + base] = r[k]
        buf[1 * DIM_F * DIM_T + base] = im[k]
        buf[2 * DIM_F * DIM_T + base] = r[k]
        buf[3 * DIM_F * DIM_T + base] = im[k]
      }
    }
    const input = new ort.Tensor('float32', buf.slice(), [1, 4, DIM_F, DIM_T])
    const res = await session.run({ [session.inputNames[0]]: input })
    const o = res[session.outputNames[0]].data
    for (let t = 0; t < DIM_T; t++) {
      const f = f0 + t
      if (f >= frames) break
      const orr = outRe[f]
      const oii = outIm[f]
      for (let k = 0; k < DIM_F; k++) {
        const base = k * DIM_T + t
        // average the two (identical) stereo channels
        orr[k] = 0.5 * (o[0 * DIM_F * DIM_T + base] + o[2 * DIM_F * DIM_T + base])
        oii[k] = 0.5 * (o[1 * DIM_F * DIM_T + base] + o[3 * DIM_F * DIM_T + base])
      }
    }
    onProgress((c + 1) / nChunks)
  }
  return mdxIstft({ re: outRe, im: outIm, length: spec.length })
}

export const MDX = { N_FFT, HOP, DIM_F, DIM_T }
