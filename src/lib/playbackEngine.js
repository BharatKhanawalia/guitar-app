import * as Tone from 'tone'

/**
 * playbackEngine.js — independent pitch & tempo playback for Audio→Chords, with
 * a phase-cancellation melody suppressor, master volume, and an output analyser.
 *
 * Tone.GrainPlayer does granular time-stretching: `playbackRate` = speed without
 * pitch change, `detune` (cents) = pitch without speed change.
 *
 * ── Graph (all Tone nodes, so it routes reliably to the speakers) ────────────
 *   grainPlayer → input ─┬─ pass ─────────────────────────┐
 *                        └─ split → (L) + (−R) → mono ── cancel ─┴─ volume → 🔈
 *                                                                    └→ analyser
 * The suppressor cross-fades `pass` (stereo) vs `cancel` (L−R mono, which nulls
 * any centre-panned lead vocal). NOTE: an earlier version wired this with raw
 * Web-Audio nodes across the Tone/native boundary and produced NO SOUND — using
 * Tone nodes throughout, terminating in .toDestination(), is what actually works.
 *
 * ── Fresh node on every seek ────────────────────────────────────────────────
 * GrainPlayer's grain clock desyncs if you stop()/start() the SAME node after a
 * rate change (the "scrub after tempo change freezes" bug). So each play/seek
 * DISPOSES the node and builds a new GrainPlayer from the cached buffer — cheap
 * (no re-decode) and always in sync.
 */
export default class PlaybackEngine {
  constructor() {
    this.player = null
    this.buffer = null
    this.duration = 0

    this._playing = false
    this._offset = 0
    this._anchor = 0
    this._rate = 1
    this._semitones = 0
    this._started = false
    this._onEnd = null
    this._endTimer = null
    this._graphBuilt = false
    // NB: the graph is built lazily in load(), NOT here. React 18 StrictMode
    // mounts → runs the load effect → runs cleanup (dispose, which tears the
    // graph down) → remounts reusing THIS SAME engine via useRef. If the graph
    // lived only in the constructor it would stay torn down and playback would be
    // silent (input → pass severed). Building it in load() makes it self-healing.
  }

  _ensureGraph() {
    if (this._graphBuilt) return
    this.volume = new Tone.Gain(1).toDestination()
    this.analyser = new Tone.Analyser('waveform', 256)
    this.volume.connect(this.analyser)

    this.input = new Tone.Gain(1)
    this.pass = new Tone.Gain(1) // stereo passthrough
    this.cancel = new Tone.Gain(0) // L−R vocal-cancel branch

    // passthrough
    this.input.connect(this.pass)
    this.pass.connect(this.volume)

    // vocal-cancel: mono sum of L + (−R)  → nulls centre-panned content
    this.split = new Tone.Split(2)
    this.invertR = new Tone.Gain(-1)
    this.monoSum = new Tone.Gain(1)
    this.input.connect(this.split)
    this.split.connect(this.monoSum, 0) // L → sum
    this.split.connect(this.invertR, 1) // R → invert
    this.invertR.connect(this.monoSum) // −R → sum
    this.monoSum.connect(this.cancel)
    this.cancel.connect(this.volume)

    this._graphBuilt = true
  }

  /** Decode on a throwaway OfflineAudioContext (works while the live context is
   *  still suspended on first launch → no MP3 decode stall). */
  async load(arrayBuffer) {
    this._ensureGraph() // (re)build the audio graph if a prior dispose tore it down
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext
    const tmp = new OAC(1, 1, 44100)
    const audio = await tmp.decodeAudioData(arrayBuffer.slice(0))
    this.buffer = new Tone.ToneAudioBuffer(audio)
    this.duration = audio.duration
    this._offset = 0
    this._playing = false
    return this.duration
  }

  onEnded(cb) {
    this._onEnd = cb
  }

  _makePlayer() {
    const p = new Tone.GrainPlayer({ url: this.buffer, grainSize: 0.12, overlap: 0.08, loop: false })
    p.playbackRate = this._rate
    p.detune = this._semitones * 100
    p.connect(this.input)
    return p
  }

  _disposePlayer() {
    if (this.player) {
      try {
        this.player.stop()
      } catch {
        /* not started */
      }
      this.player.dispose()
      this.player = null
    }
  }

  /* ---- transport --------------------------------------------------- */

  async play() {
    if (!this.buffer || this._playing) return
    if (!this._started) {
      await Tone.start() // resume the AudioContext on the user gesture
      this._started = true
    }
    this._startFrom(Math.min(this._offset, this.duration))
  }

  _startFrom(from) {
    this._disposePlayer()
    this.player = this._makePlayer()
    this._anchor = Tone.now()
    this._offset = from
    this._playing = true
    this.player.start(this._anchor + 0.03, from)
    this._scheduleEnd(from)
  }

  pause() {
    if (!this._playing) return
    this._offset = this.positionSeconds()
    this._playing = false
    this._disposePlayer()
    this._clearEnd()
  }

  async toggle() {
    this._playing ? this.pause() : await this.play()
  }

  seek(seconds) {
    const t = Math.max(0, Math.min(seconds, this.duration))
    this._offset = t
    if (this._playing) this._startFrom(t)
  }

  /* ---- pitch & tempo ---------------------------------------------- */

  setRate(rate) {
    const r = Math.max(0.25, Math.min(3, rate))
    this._offset = this.positionSeconds()
    this._anchor = Tone.now()
    this._rate = r
    if (this.player) this.player.playbackRate = r
    if (this._playing) this._scheduleEnd(this._offset)
  }

  setSemitones(semi) {
    this._semitones = semi
    if (this.player) this.player.detune = semi * 100
  }

  /* ---- melody suppressor, volume, metering ------------------------ */

  setMelodySuppress(on) {
    this.pass.gain.rampTo(on ? 0 : 1, 0.03)
    this.cancel.gain.rampTo(on ? 1 : 0, 0.03)
  }

  setVolume(v) {
    this.volume.gain.rampTo(Math.max(0, Math.min(1.5, v)), 0.02)
  }

  /** RMS of the current output (0..1) — used to prove sound is actually flowing
   *  and to drive a level meter. */
  getLevel() {
    const buf = this.analyser.getValue()
    let s = 0
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
    return Math.sqrt(s / buf.length)
  }

  /* ---- position ---------------------------------------------------- */

  positionSeconds() {
    if (!this._playing) return this._offset
    const elapsed = (Tone.now() - this._anchor) * this._rate
    return Math.min(this._offset + elapsed, this.duration)
  }

  isPlaying() {
    return this._playing
  }
  scaledDuration() {
    return this.duration / this._rate
  }

  dispose() {
    this._clearEnd()
    this._disposePlayer()
    ;[this.input, this.pass, this.cancel, this.split, this.invertR, this.monoSum, this.volume, this.analyser].forEach(
      (n) => n?.dispose?.(),
    )
    this.buffer?.dispose?.()
    this.buffer = null
    this._playing = false
    this._graphBuilt = false // force a rebuild on the next load() (StrictMode-safe)
  }

  /* ---- end-of-song scheduling ------------------------------------- */

  _scheduleEnd(fromOriginal) {
    this._clearEnd()
    const remainingWall = ((this.duration - fromOriginal) / this._rate) * 1000
    this._endTimer = setTimeout(() => {
      this._playing = false
      this._offset = this.duration
      this._disposePlayer()
      this._onEnd?.()
    }, Math.max(0, remainingWall + 80))
  }

  _clearEnd() {
    if (this._endTimer) clearTimeout(this._endTimer)
    this._endTimer = null
  }
}
