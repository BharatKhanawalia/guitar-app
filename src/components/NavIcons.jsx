/**
 * Animated line icons from the Fretwork handoff — one per module, plus the
 * "door" icon used for Home. Each SVG carries `.anim-*` marker classes on the
 * moving sub-element; the hover animation is driven from CSS (see index.css,
 * `.gt-ico-host:hover .anim-*`) so any ancestor with the `gt-ico-host` class
 * plays it — the navbar button and the overlay menu row both use that hook.
 *
 * Icons inherit `currentColor`, so the parent decides the resting colour
 * (muted in the overlay, white on an active navbar pill).
 */

// Canonical icon key per app tab id ('ar' is Magic Chords in this codebase).
const KEY = { home: 'home', capo: 'capo', sheet: 'sheet', strum: 'strum', tuner: 'tuner', ar: 'magic', audio: 'audio' }

function Svg({ size, strokeWidth = 1.5, children, fillMode = false }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={fillMode ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const ICONS = {
  home: (size) => (
    <Svg size={size} strokeWidth={1.6}>
      <path d="M4 21V5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v16" />
      <path d="M2 21h19" />
      <rect
        className="anim-door"
        x="5"
        y="5"
        width="11"
        height="15"
        rx="1"
        fill="currentColor"
        fillOpacity=".16"
        strokeWidth="1.1"
        style={{ transformOrigin: '5px 12px' }}
      />
      <circle cx="13" cy="13" r="1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  capo: (size) => (
    <Svg size={size} strokeWidth={1.4}>
      <rect x="2" y="8" width="20" height="8" rx="2" />
      <line x1="7" y1="8" x2="7" y2="16" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="17" y1="8" x2="17" y2="16" />
      <line x1="3" y1="10.5" x2="21" y2="10.5" opacity=".55" />
      <line x1="3" y1="12" x2="21" y2="12" opacity=".55" />
      <line x1="3" y1="13.5" x2="21" y2="13.5" opacity=".55" />
      <rect className="anim-capo" x="9" y="6" width="2.6" height="12" rx="1.3" fill="currentColor" stroke="none" />
    </Svg>
  ),
  sheet: (size) => (
    <Svg size={size}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="11" x2="16" y2="11" />
      <line x1="8" y1="14" x2="13" y2="14" />
      <circle className="anim-sheet" cx="15.5" cy="16" r="1.8" fill="currentColor" stroke="none" />
    </Svg>
  ),
  strum: (size) => (
    <Svg size={size}>
      {/* Strings are gentle curves so they can bow into low-curvature waves. */}
      <g className="anim-strum">
        <path className="s1" d="M6 4 Q6 12 6 20" />
        <path className="s2" d="M10 4 Q10 12 10 20" />
        <path className="s3" d="M14 4 Q14 12 14 20" />
        <path className="s4" d="M18 4 Q18 12 18 20" />
      </g>
    </Svg>
  ),
  tuner: (size) => (
    <Svg size={size}>
      <path d="M4 18a8 8 0 0 1 16 0" />
      <line className="anim-tuner" x1="12" y1="18" x2="12" y2="8" style={{ transformOrigin: '12px 18px' }} />
      <circle cx="12" cy="18" r="1.8" fill="currentColor" stroke="none" />
    </Svg>
  ),
  magic: (size) => (
    <Svg size={size}>
      <g className="anim-magic">
        <g className="hand" style={{ transformOrigin: '7px 15px' }}>
          <rect x="4.5" y="12" width="5" height="6" rx="2" />
          <line x1="7" y1="12" x2="7" y2="6.5" />
        </g>
        <g className="hand hand2" style={{ transformOrigin: '17px 15px' }}>
          <rect x="14.5" y="12" width="5" height="6" rx="2" />
          <line x1="17" y1="12" x2="17" y2="6.5" />
        </g>
      </g>
    </Svg>
  ),
  audio: (size) => (
    <Svg size={size} fillMode>
      <g className="anim-audio">
        <rect x="4" y="8" width="3.5" height="12" rx="1.5" fill="currentColor" style={{ transformOrigin: 'center bottom' }} />
        <rect x="10.25" y="5" width="3.5" height="15" rx="1.5" fill="currentColor" style={{ transformOrigin: 'center bottom' }} />
        <rect x="16.5" y="11" width="3.5" height="9" rx="1.5" fill="currentColor" style={{ transformOrigin: 'center bottom' }} />
      </g>
    </Svg>
  ),
}

export default function ModuleIcon({ id, size = 34 }) {
  const key = KEY[id] || id
  const render = ICONS[key]
  return render ? render(size) : null
}
