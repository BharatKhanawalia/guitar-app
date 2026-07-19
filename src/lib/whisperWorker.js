/**
 * whisperWorker.js — off-main-thread lyric transcription with Whisper (base,
 * multilingual so Hindi/Urdu songs like khudajane.mp3 work) via transformers.js.
 *
 * Runs on WebGPU when available (falls back to WASM), takes 16 kHz mono PCM and
 * returns WORD-level timestamps. The main thread groups those words into lyric
 * lines that anchor the Phrase Ribbon's rows.
 */
import { pipeline, env } from '@huggingface/transformers'

// Always fetch weights from the HF CDN (no local model files bundled).
env.allowLocalModels = false

const MODEL = 'onnx-community/whisper-base'
let transcriber = null
let device = 'webgpu'

async function getTranscriber() {
  if (transcriber) return transcriber
  const progress_callback = (p) => self.postMessage({ type: 'progress', phase: 'model', data: p })
  // Let transformers.js pick the best dtype per device (forcing fp32 404'd some
  // variants and killed the whole run). WebGPU first, CPU WASM as the fallback.
  try {
    transcriber = await pipeline('automatic-speech-recognition', MODEL, { device: 'webgpu', progress_callback })
    device = 'webgpu'
  } catch (e) {
    self.postMessage({ type: 'progress', phase: 'fallback', data: String(e?.message || e) })
    transcriber = await pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', progress_callback })
    device = 'wasm'
  }
  return transcriber
}

self.onmessage = async (e) => {
  const { audio } = e.data
  try {
    const t = await getTranscriber()
    self.postMessage({ type: 'progress', phase: 'transcribe', data: 0 })
    const out = await t(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    })
    self.postMessage({ type: 'done', device, chunks: out.chunks || [], text: out.text || '' })
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) })
  }
}
