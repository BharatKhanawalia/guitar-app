/**
 * whisper.js — main-thread façade for lyric transcription.
 *
 * Decodes audio to 16 kHz mono, hands it to the Whisper worker, and groups the
 * returned word timestamps into lyric LINES. Those line-start times become the
 * Phrase Ribbon's row boundaries, which is what guarantees "first word → first
 * chord block".
 */

let worker = null

function getWorker() {
  if (!worker) worker = new Worker(new URL('./whisperWorker.js', import.meta.url), { type: 'module' })
  return worker
}

/** Decode arbitrary audio bytes to a 16 kHz mono Float32Array (what Whisper wants). */
async function decode16k(bytes) {
  const AC = window.AudioContext || window.webkitAudioContext
  const tmp = new AC()
  let buf
  try {
    buf = await tmp.decodeAudioData(bytes.slice(0))
  } finally {
    tmp.close()
  }
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000)
  const src = off.createBufferSource()
  src.buffer = buf
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return rendered.getChannelData(0).slice()
}

/** Linear-resample already-decoded mono PCM to 16 kHz (for a separated stem). */
function resamplePcm16k(pcm, sampleRate) {
  if (sampleRate === 16000) return pcm.slice()
  const ratio = sampleRate / 16000
  const outLen = Math.max(1, Math.floor(pcm.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const p = i * ratio
    const i0 = Math.floor(p)
    const fr = p - i0
    out[i] = pcm[i0] * (1 - fr) + (pcm[i0 + 1] || 0) * fr
  }
  return out
}

/** Group Whisper word chunks into lyric lines (split on pauses / punctuation / length). */
function groupLines(chunks) {
  const words = (chunks || [])
    .filter((c) => c && c.timestamp && c.timestamp[0] != null)
    .map((c) => ({
      text: (c.text || '').trim(),
      start: c.timestamp[0],
      end: c.timestamp[1] != null ? c.timestamp[1] : c.timestamp[0] + 0.3,
    }))
    .filter((w) => w.text)
  if (!words.length) return null

  const lines = []
  let cur = []
  const flush = () => {
    if (!cur.length) return
    lines.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(' '),
      words: cur.slice(),
    })
    cur = []
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const prev = words[i - 1]
    if (prev) {
      const gap = w.start - prev.end
      if (gap > 0.9 || cur.length >= 9 || /[.?!。！？]$/.test(prev.text)) flush()
    }
    cur.push(w)
  }
  flush()
  return lines.length ? { lines } : null
}

/**
 * Transcribe lyrics.
 * @param {ArrayBuffer | {pcm: Float32Array, sampleRate: number}} input
 *   Pass raw file bytes (decoded here) OR an already-decoded mono PCM stem — the
 *   AI path passes the SEPARATED VOCAL stem so Whisper reads a clean voice, not the
 *   full mix (that's what makes lyrics legible on music).
 * @param {{onProgress?: (m:object)=>void}} [opts]
 * @returns {Promise<{lines: object[]}|null>}
 */
export function transcribeLyrics(input, { onProgress } = {}) {
  const prep =
    input && input.pcm
      ? Promise.resolve(resamplePcm16k(input.pcm, input.sampleRate || 16000))
      : decode16k(input)
  return new Promise((resolve, reject) => {
    prep
      .then((audio) => {
        const w = getWorker()
        const onMsg = (e) => {
          const m = e.data
          if (m.type === 'progress') onProgress?.(m)
          else if (m.type === 'done') {
            w.removeEventListener('message', onMsg)
            resolve(groupLines(m.chunks))
          } else if (m.type === 'error') {
            w.removeEventListener('message', onMsg)
            reject(new Error(m.message))
          }
        }
        w.addEventListener('message', onMsg)
        w.postMessage({ audio }, [audio.buffer])
      })
      .catch(reject)
  })
}
