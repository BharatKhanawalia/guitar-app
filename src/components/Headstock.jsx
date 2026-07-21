import { motion } from 'framer-motion'
import { GUITAR_STRINGS } from '../lib/tuner'
import { pluckNote } from '../lib/stringPluck'

/**
 * Headstock — an anatomically-correct, front-facing 6-string acoustic guitar
 * headstock drawn in raw SVG.
 *
 *   • A central vertical wooden headstock, rounded + slightly wider at the top,
 *     tapering down to the nut.
 *   • A bone/ivory nut across the very bottom where the fretboard begins.
 *   • Six 3+3 tuning machines on the OUTER edges:
 *        Left  (bottom→top): E (6th), A (5th), D (4th)
 *        Right (bottom→top): e (1st), B (2nd), G (3rd)
 *   • Six strings that leave the nut, run straight up their "speaking length",
 *     then angle outward to wrap around the correct peg post.
 *
 * The plucked string (from YIN detection) vibrates along its speaking length and
 * its machine head lights up — violet while tuning, mint-green once in tune.
 */

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */
const W = 260
const H = 496
const CX = 130

const NUT_Y = 420 // top edge of the nut / start of the speaking length
const FRETBOARD_BOTTOM = 486 // a sliver of fretboard below the nut

// Body outline control points
const NUT_HALF = 44 // half-width of the wood at the nut  → spans 86..174
const TOP_HALF = 66 // half-width of the wood at the crown → spans 64..196
const SHOULDER_Y = 96
const TOP_Y = 30

// Peg rows, nearest-nut → furthest (bottom, middle, top)
const ROW_Y = [332, 226, 120]
const L_BUTTON_X = 32
const L_POST_X = 62 // where the string wraps on the left posts
const R_BUTTON_X = 228
const R_POST_X = 198

// Nut string anchor points, left→right = 6th(E) … 1st(e)
const NUT_L = 94
const NUT_R = 166

/**
 * Row assignment per string index (0..5 = 6th..1st):
 *   inner strings (D, G) reach the furthest/top pegs, outer strings (E, e) the
 *   nearest/bottom pegs — exactly how a real 3+3 headstock routes.
 */
const ROW_OF = [0, 1, 2, 2, 1, 0]
const SIDE_OF = ['L', 'L', 'L', 'R', 'R', 'R']

const LAYOUT = GUITAR_STRINGS.map((s, i) => {
  const side = SIDE_OF[i]
  const pegY = ROW_Y[ROW_OF[i]]
  const nutX = NUT_L + ((NUT_R - NUT_L) * i) / 5
  const postX = side === 'L' ? L_POST_X : R_POST_X
  const buttonX = side === 'L' ? L_BUTTON_X : R_BUTTON_X
  // Run straight up to just below the peg, then angle out to the post.
  const bendY = pegY + 34
  return { ...s, i, side, pegY, nutX, postX, buttonX, bendY }
})

/** Static string: nut → straight up → angle to the peg post. */
function stringPath(s) {
  return `M ${s.nutX} ${NUT_Y} L ${s.nutX} ${s.bendY} L ${s.postX} ${s.pegY}`
}

/** Vibrating string: a sine along the speaking length (nut→bend), then the
 *  fixed leader to the post. Amplitude tapers to 0 at both anchored ends. */
function vibratingPath(s, amp) {
  const seg = 18
  let d = ''
  for (let k = 0; k <= seg; k++) {
    const t = k / seg
    const y = NUT_Y + (s.bendY - NUT_Y) * t
    const env = Math.sin(t * Math.PI) // 0 at nut & bend, 1 in the middle
    const off = amp * env * Math.sin(t * Math.PI * 3)
    d += (k === 0 ? 'M' : 'L') + (s.nutX + off).toFixed(2) + ' ' + y.toFixed(2) + ' '
  }
  d += `L ${s.postX} ${s.pegY}`
  return d.trim()
}

/* ------------------------------------------------------------------ */
/* Machine head (tuning peg)                                          */
/* ------------------------------------------------------------------ */
function Peg({ s, isNear, inTune, done }) {
  const inner = s.side === 'L' ? s.buttonX + 12 : s.buttonX - 12
  const labelX = s.side === 'L' ? s.buttonX - 32 : s.buttonX + 32
  const activeGreen = (isNear && inTune) || done
  const accent = activeGreen ? '#34d399' : '#8b5cf6'
  const labelColor = activeGreen ? '#4ade80' : isNear ? '#c4b5fd' : 'rgba(233,230,245,0.6)'
  const labelGlow = activeGreen ? '0 0 10px rgba(52,211,153,0.9)' : isNear ? '0 0 8px rgba(139,92,246,0.75)' : null

  return (
    <motion.g
      animate={{ scale: isNear ? 1.12 : 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 18 }}
      style={{ originX: `${s.buttonX}px`, originY: `${s.pegY}px` }}
    >
      {/* soft glow halo while tuning / once done */}
      {(isNear || done) && <circle cx={s.buttonX} cy={s.pegY} r={24} fill={accent} opacity={0.16} />}

      {/* chrome post — bar from the wood edge out to the button */}
      <rect
        x={Math.min(inner, s.postX)}
        y={s.pegY - 3.5}
        width={Math.abs(s.postX - inner)}
        height={7}
        rx={3.5}
        fill="url(#hs-chrome-post)"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="0.6"
      />
      {/* string post collar where the string wraps */}
      <circle cx={s.postX} cy={s.pegY} r={5.4} fill="url(#hs-chrome-knob)" stroke="rgba(0,0,0,0.4)" strokeWidth="0.8" />
      <circle cx={s.postX} cy={s.pegY} r={1.8} fill="rgba(28,30,40,0.6)" />

      {/* chrome tuner button (the knob you turn) */}
      <ellipse
        cx={s.buttonX}
        cy={s.pegY}
        rx={17}
        ry={12}
        fill="url(#hs-chrome-knob)"
        stroke="rgba(18,20,28,0.55)"
        strokeWidth={1.2}
        style={{ filter: isNear || done ? `drop-shadow(0 0 9px ${accent})` : 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}
      />
      {/* specular shine for the chrome look */}
      <ellipse cx={s.buttonX - 3.5} cy={s.pegY - 3.8} rx={8} ry={3.6} fill="rgba(255,255,255,0.6)" />
      {/* coloured ring while tuning / once tuned */}
      {(isNear || done) && (
        <ellipse cx={s.buttonX} cy={s.pegY} rx={17} ry={12} fill="none" stroke={activeGreen ? '#34d399' : '#a78bfa'} strokeWidth={2} />
      )}

      {/* string label — larger, glows green once tuned, and taps to hear the
          open-string note. */}
      <g
        onClick={() => pluckNote(s.name, 0.85)}
        style={{ cursor: 'pointer' }}
        role="button"
        aria-label={`Play open ${s.label} string`}
      >
        <circle cx={labelX} cy={s.pegY} r={18} fill="transparent" />
        <text
          x={labelX}
          y={s.pegY + 6}
          textAnchor="middle"
          fontSize="21"
          fontWeight="800"
          fontFamily="JetBrains Mono, monospace"
          fill={labelColor}
          style={labelGlow ? { filter: `drop-shadow(${labelGlow})` } : undefined}
        >
          {s.label}
        </text>
        {done && (
          <text x={labelX} y={s.pegY + 22} textAnchor="middle" fontSize="11" fontWeight="700" fill="#4ade80" fontFamily="JetBrains Mono, monospace">
            ✓
          </text>
        )}
      </g>
    </motion.g>
  )
}

/* ------------------------------------------------------------------ */
export default function Headstock({ pitch, active, inTune, completed }) {
  const nearName = pitch?.nearestString?.name

  // Body outline: nut corners → shoulders → rounded crown → back down.
  const body = `
    M ${CX - NUT_HALF} ${NUT_Y}
    L ${CX - TOP_HALF} ${SHOULDER_Y}
    Q ${CX - TOP_HALF} ${TOP_Y} ${CX} ${TOP_Y - 6}
    Q ${CX + TOP_HALF} ${TOP_Y} ${CX + TOP_HALF} ${SHOULDER_Y}
    L ${CX + NUT_HALF} ${NUT_Y}
    Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[210px] mx-auto overflow-visible">
      <defs>
        <linearGradient id="hs-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a2b1a" />
          <stop offset="0.5" stopColor="#4a3624" />
          <stop offset="1" stopColor="#2a1e12" />
        </linearGradient>
        <linearGradient id="hs-wood-edge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(255,255,255,0.10)" />
          <stop offset="0.5" stopColor="rgba(255,255,255,0)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.25)" />
        </linearGradient>
        <linearGradient id="hs-fretboard" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#241a12" />
          <stop offset="1" stopColor="#160f0a" />
        </linearGradient>
        <linearGradient id="hs-nut" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4efe2" />
          <stop offset="1" stopColor="#cfc7b3" />
        </linearGradient>
        {/* Chrome / polished-steel finish for the tuning machines. */}
        <radialGradient id="hs-chrome-knob" cx="0.34" cy="0.28" r="0.95">
          <stop offset="0" stopColor="#fbfcff" />
          <stop offset="0.35" stopColor="#ccd2de" />
          <stop offset="0.7" stopColor="#868da0" />
          <stop offset="1" stopColor="#565d6f" />
        </radialGradient>
        <linearGradient id="hs-chrome-post" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eef1f7" />
          <stop offset="0.5" stopColor="#aab1bf" />
          <stop offset="1" stopColor="#6a7182" />
        </linearGradient>
      </defs>

      {/* Fretboard sliver below the nut */}
      <rect
        x={CX - NUT_HALF + 6}
        y={NUT_Y}
        width={2 * NUT_HALF - 12}
        height={FRETBOARD_BOTTOM - NUT_Y}
        fill="url(#hs-fretboard)"
      />

      {/* Wooden headstock body */}
      <path d={body} fill="url(#hs-wood)" stroke="rgba(0,0,0,0.4)" strokeWidth="2" />
      <path d={body} fill="url(#hs-wood-edge)" opacity="0.7" />
      {/* subtle inner bevel */}
      <path
        d={body}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="1"
        style={{ transform: 'scale(0.94)', transformOrigin: `${CX}px ${NUT_Y}px` }}
      />
      {/* engraved logo dot */}
      <circle cx={CX} cy={TOP_Y + 34} r={4} fill="rgba(255,255,255,0.14)" />
      <text
        x={CX}
        y={TOP_Y + 62}
        textAnchor="middle"
        fontSize="9"
        letterSpacing="2"
        fontFamily="JetBrains Mono, monospace"
        fill="rgba(255,255,255,0.18)"
      >
        CAPOFLOW
      </text>

      {/* The bone nut */}
      <rect
        x={CX - NUT_HALF - 2}
        y={NUT_Y - 7}
        width={2 * NUT_HALF + 4}
        height={8}
        rx={2.5}
        fill="url(#hs-nut)"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="0.75"
      />

      {/* Strings + pegs */}
      {LAYOUT.map((s) => {
        const isNear = active && nearName === s.name
        const done = completed?.has(s.name)
        const glow = isNear ? (inTune ? '#34d399' : '#8b5cf6') : 'transparent'
        // low strings are visibly thicker
        const gauge = 1.3 + (5 - s.i) * 0.42

        return (
          <g key={s.name}>
            {isNear ? (
              <motion.path
                fill="none"
                stroke={inTune ? '#34d399' : '#c4b5fd'}
                strokeWidth={gauge}
                strokeLinecap="round"
                initial={false}
                animate={{ d: [vibratingPath(s, 3.4), vibratingPath(s, -3.4), vibratingPath(s, 3.4)] }}
                transition={{ duration: 0.13, repeat: Infinity, ease: 'linear' }}
                style={{ filter: `drop-shadow(0 0 6px ${glow})` }}
              />
            ) : (
              <path
                d={stringPath(s)}
                fill="none"
                stroke={done ? 'rgba(74,222,128,0.6)' : 'rgba(226,222,240,0.55)'}
                strokeWidth={gauge}
                strokeLinecap="round"
              />
            )}

            <Peg s={s} isNear={isNear} inTune={inTune} done={done} />
          </g>
        )
      })}
    </svg>
  )
}
