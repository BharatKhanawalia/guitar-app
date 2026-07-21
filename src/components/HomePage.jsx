/**
 * Home / landing page from the Fretwork handoff: hero (eyebrow pill, gradient
 * "toolkit" headline, sub-copy, two CTAs), the 6-string neon-bead band with
 * floating notes, a frozen bottom marquee, the six module cards, and a stats
 * strip. Colours, sizes and animation timings mirror the prototype.
 */
import StringBand from './StringBand'

const NOTES = [
  { l: 15, t: 24, sz: 26, c: 'var(--gt-accent2)', dl: 0, du: 7.5, g: '♪' },
  { l: 33, t: 62, sz: 20, c: 'var(--gt-mint)', dl: 1.6, du: 8.2, g: '♫' },
  { l: 50, t: 14, sz: 31, c: 'var(--gt-accent2)', dl: 2.8, du: 7, g: '♩' },
  { l: 64, t: 72, sz: 22, c: 'var(--gt-rose)', dl: 0.7, du: 8.6, g: '♬' },
  { l: 78, t: 30, sz: 35, c: 'var(--gt-mint)', dl: 3.6, du: 7.2, g: '♪' },
  { l: 89, t: 58, sz: 25, c: 'var(--gt-accent2)', dl: 2.0, du: 9, g: '♫' },
  { l: 42, t: 40, sz: 18, c: 'var(--gt-rose)', dl: 4.4, du: 8, g: '♩' },
]

const MODULES = [
  { id: 'capo', num: '01', name: 'Capo Calculator', desc: 'The exact fret that turns barre chords into open shapes.', span: 'span 7 / span 7', color: 'var(--gt-accent)', tall: true },
  { id: 'ar', num: '05', name: 'Magic Chords', desc: 'Play in the air with your webcam. The flagship.', span: 'span 5 / span 5', color: 'var(--gt-mint)', badge: 'FLAGSHIP', tall: true },
  { id: 'sheet', num: '02', name: 'Sheet Transposer', desc: 'Paste, transpose, export a chord sheet.', span: 'span 4 / span 4', color: 'var(--gt-accent)' },
  { id: 'strum', num: '03', name: 'Strumming Studio', desc: 'Sequence expressive, humanized rhythms.', span: 'span 4 / span 4', color: 'var(--gt-rose)' },
  { id: 'tuner', num: '04', name: 'Guitar Tuner', desc: 'Chromatic, precise, private.', span: 'span 4 / span 4', color: 'var(--gt-mint)' },
  { id: 'audio', num: '06', name: 'Audio → Chords', desc: 'Detect chords, key and BPM on-device.', span: 'span 12 / span 12', color: 'var(--gt-amber)', badge: 'SOON' },
]

const STATS = [
  { value: '14', label: 'Air instruments in Magic Chords' },
  { value: '0-11', label: 'Capo positions ranked instantly' },
  { value: '0', label: 'Bytes ever uploaded to a server' },
  { value: '<5ms', label: 'From tap to sound' },
]

const MARQUEE = [
  'CAPO CALCULATOR', 'SHEET TRANSPOSER', 'STRUMMING STUDIO', 'GUITAR TUNER', 'MAGIC CHORDS',
  'AUDIO → CHORDS', 'ZERO LATENCY', 'FULLY PRIVATE', 'REAL AUDIO', 'NO ACCOUNTS',
]

export default function HomePage({ onOpen }) {
  return (
    <div style={{ paddingBottom: 74 }}>
      {/* ---------------- Hero ---------------- */}
      <section
        className="relative flex flex-col justify-center overflow-hidden"
        style={{ gap: 'clamp(18px,3.5vh,44px)', padding: 'clamp(20px,3vh,40px) clamp(8px,3vw,40px) 60px' }}
      >
        <div className="relative z-[2] text-center" style={{ maxWidth: 880, margin: '0 auto' }}>
          <span
            className="inline-flex items-center gap-2 font-mono gt-anim-reveal"
            style={{
              fontSize: 11,
              padding: '7px 14px',
              borderRadius: 30,
              background: 'var(--gt-panel)',
              border: '1px solid var(--gt-border)',
              color: 'var(--gt-muted)',
              letterSpacing: '0.04em',
              animation: 'gt-reveal 0.7s ease both',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gt-mint)', boxShadow: '0 0 8px var(--gt-mint)' }} />
            100% in your browser · zero latency · no accounts
          </span>

          <h1
            className="font-display gt-anim-reveal"
            style={{
              margin: '18px 0 0',
              fontWeight: 700,
              fontSize: 'clamp(40px,7vw,92px)',
              lineHeight: 0.94,
              letterSpacing: '-0.045em',
              color: 'var(--gt-text)',
              animation: 'gt-reveal 0.8s cubic-bezier(0.16,0.84,0.44,1) both',
            }}
          >
            Your whole guitar
            <br />
            <span className="gt-grad-text">toolkit</span>, in one tab.
          </h1>

          <p
            className="gt-anim-reveal"
            style={{
              maxWidth: 520,
              margin: '20px auto 0',
              fontSize: 'clamp(14px,1.5vw,17px)',
              lineHeight: 1.55,
              color: 'var(--gt-muted)',
              animation: 'gt-reveal 0.9s ease both',
            }}
          >
            Capo maths, transposing, rhythm practice, a tuner, and a webcam instrument that lets you play in the air.
            Real audio, instant, private.
          </p>

          <div
            className="flex flex-wrap justify-center gt-anim-reveal"
            style={{ gap: 14, marginTop: 26, animation: 'gt-reveal 1s ease both' }}
          >
            <button
              onClick={() => onOpen('capo')}
              className="gt-btn gt-btn-primary"
              style={{ height: 52, padding: '0 26px', fontSize: 15, borderRadius: 15 }}
            >
              Open the toolkit <span style={{ fontSize: 17 }}>→</span>
            </button>
            <button
              onClick={() => onOpen('ar')}
              className="gt-btn gt-btn-ghost"
              style={{ height: 52, padding: '0 22px', fontSize: 15, borderRadius: 15 }}
            >
              ✦ Try Magic Chords
            </button>
          </div>
        </div>

        {/* Neon string band (pluckable) + floating notes */}
        <div
          className="relative w-full"
          style={{ maxWidth: 1120, margin: '0 auto', height: 'clamp(150px,20vw,220px)' }}
        >
          <StringBand />
          {NOTES.map((n, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="gt-anim-notefloat absolute"
              style={{
                left: `${n.l}%`, top: `${n.t}%`, fontSize: n.sz, color: n.c,
                textShadow: `0 0 16px ${n.c}, 0 0 6px ${n.c}`, opacity: 0, pointerEvents: 'none',
                animation: `gt-notefloat ${n.du}s ease-in-out ${n.dl}s infinite`,
              }}
            >
              {n.g}
            </span>
          ))}
        </div>
      </section>

      {/* ---------------- Module cards ---------------- */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(40px,7vw,80px) clamp(8px,3vw,40px)' }}>
        <div className="flex items-end justify-between flex-wrap" style={{ gap: 20, marginBottom: 36 }}>
          <div>
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--gt-accent)', letterSpacing: '0.16em' }}>SIX MODULES</span>
            <h2 className="font-display" style={{ margin: '10px 0 0', fontSize: 'clamp(30px,4.4vw,52px)', fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1, color: 'var(--gt-text)' }}>
              Everything a player needs.
            </h2>
          </div>
          <p style={{ maxWidth: 320, fontSize: 14, color: 'var(--gt-muted)', lineHeight: 1.55, margin: 0 }}>
            Each tool is real-time and offline-first. Pick one to dive in — or wander.
          </p>
        </div>

        <div className="gt-module-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
          {MODULES.map((m, i) => (
            <button
              key={m.id}
              onClick={() => onOpen(m.id)}
              className="gt-card gt-anim-reveal text-left relative overflow-hidden"
              style={{
                gridColumn: m.span,
                minHeight: m.tall ? 260 : 200,
                padding: 26,
                borderRadius: 22,
                border: '1px solid var(--gt-border)',
                background: 'linear-gradient(160deg, var(--gt-panel), color-mix(in srgb, var(--gt-panel) 70%, transparent))',
                cursor: 'pointer',
                animation: 'gt-reveal 0.8s cubic-bezier(0.16,0.84,0.44,1) both',
                animationDelay: `${i * 0.07}s`,
              }}
            >
              <div
                className="absolute pointer-events-none"
                style={{
                  top: -70, right: -50, width: 240, height: 240, borderRadius: '50%', opacity: 0.5,
                  background: `radial-gradient(circle, color-mix(in srgb, ${m.color} 26%, transparent), transparent 68%)`,
                }}
              />
              <div className="relative flex flex-col h-full">
                <div className="flex items-start justify-between">
                  <span
                    className="font-display"
                    style={{ fontSize: 38, fontWeight: 700, color: 'transparent', WebkitTextStroke: '1.4px var(--gt-border-hi)', letterSpacing: '-0.03em' }}
                  >
                    {m.num}
                  </span>
                  {m.badge && (
                    <span
                      className="font-mono"
                      style={{ fontSize: 9, padding: '4px 9px', borderRadius: 20, background: `color-mix(in srgb, ${m.color} 18%, transparent)`, color: m.color, letterSpacing: '0.08em', fontWeight: 600 }}
                    >
                      {m.badge}
                    </span>
                  )}
                </div>
                <div className="flex-1" />
                <h3 className="font-display" style={{ margin: '20px 0 0', fontSize: 23, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--gt-text)' }}>
                  {m.name}
                </h3>
                <p style={{ margin: '7px 0 0', fontSize: 13, color: 'var(--gt-muted)', lineHeight: 1.5, maxWidth: 280 }}>{m.desc}</p>
                <div className="flex items-center" style={{ gap: 8, marginTop: 18, fontSize: 12.5, fontWeight: 600, color: m.color }}>
                  Open <span style={{ fontSize: 15 }}>→</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ---------------- Stats ---------------- */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '0 clamp(8px,3vw,40px) clamp(40px,7vw,80px)' }}>
        <div
          className="gt-anim-reveal"
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 1,
            background: 'var(--gt-border)', border: '1px solid var(--gt-border)', borderRadius: 22, overflow: 'hidden',
            animation: 'gt-reveal 0.8s ease both',
          }}
        >
          {STATS.map((s) => (
            <div key={s.label} style={{ background: 'var(--gt-panel)', padding: '32px 26px' }}>
              <div
                className="font-display"
                style={{
                  fontSize: 'clamp(36px,4.5vw,52px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1,
                  background: 'linear-gradient(120deg, var(--gt-accent2), var(--gt-mint))',
                  WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
                }}
              >
                {s.value}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gt-muted)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Frozen bottom marquee ---------------- */}
      <div
        aria-hidden="true"
        className="fixed left-0 right-0 bottom-0 z-40 overflow-hidden"
        style={{
          borderTop: '1px solid var(--gt-border)', padding: '13px 0',
          background: 'color-mix(in srgb, var(--gt-bg2) 72%, transparent)', backdropFilter: 'blur(10px)',
        }}
      >
        <div
          className="flex font-mono"
          style={{ gap: 40, width: 'max-content', animation: 'gt-drift 28s linear infinite', fontSize: 14, color: 'var(--gt-muted)' }}
        >
          {[...MARQUEE, ...MARQUEE].map((m, i) => (
            <span key={i} className="flex items-center" style={{ gap: 40 }}>
              {m} <span style={{ color: 'var(--gt-accent)' }}>●</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
