/**
 * mp3.js — transcode a recorded webm/opus audio Blob to a widely-compatible MP3.
 * Browsers' MediaRecorder can't emit MP3 directly (Chrome only does webm/opus), so
 * we decode the recording to PCM and re-encode with lamejs. Lazy-loaded so the
 * encoder only ships when someone actually records audio.
 */
function floatToInt16(f) {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

export async function blobToMp3(blob) {
  const AC = window.AudioContext || window.webkitAudioContext
  const ac = new AC()
  let buf
  try {
    buf = await ac.decodeAudioData(await blob.arrayBuffer())
  } finally {
    ac.close()
  }
  const lame = await import('@breezystack/lamejs')
  const Mp3Encoder = lame.Mp3Encoder || lame.default?.Mp3Encoder
  if (!Mp3Encoder) throw new Error('mp3 encoder unavailable')

  const channels = Math.min(2, buf.numberOfChannels)
  const enc = new Mp3Encoder(channels, buf.sampleRate, 128)
  const left = floatToInt16(buf.getChannelData(0))
  const right = channels > 1 ? floatToInt16(buf.getChannelData(1)) : null
  const block = 1152
  const out = []
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block)
    const chunk = right ? enc.encodeBuffer(l, right.subarray(i, i + block)) : enc.encodeBuffer(l)
    if (chunk.length) out.push(new Int8Array(chunk))
  }
  const tail = enc.flush()
  if (tail.length) out.push(new Int8Array(tail))
  return new Blob(out, { type: 'audio/mpeg' })
}
