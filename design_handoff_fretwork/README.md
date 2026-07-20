# Handoff: Fretwork — Home page, global menu, theme & motion

## Overview
This bundle hands off **selected elements** of a guitar-toolkit prototype into an **existing project** that already works. The goal is NOT to rebuild the whole app — only the pieces listed under "SCOPE — TAKE" below, recreated in the target codebase's own stack (React/Vue/Svelte/etc.) using its existing components and conventions. Everything under "SCOPE — KEEP" must stay exactly as it already is in the target project.

## About the design files
- `Guitar Toolkit.dc.html` — the full prototype. It is a **design reference**, not production code to copy verbatim. Open it in a browser to see the intended look, motion, and timing. Recreate these behaviors idiomatically in the target codebase; do not ship the HTML directly.
- `ChordDiagram.dc.html` — a small sub-component used by the Capo module (not in scope here; included only for completeness).
- Exact values below are authoritative. When something says "see prototype," open the HTML and read the inline styles / `<style>` keyframes.

## Fidelity
**High-fidelity.** Colors, fonts, spacing, and animation timings are final — match them precisely.

---

## SCOPE — what to do

### ✅ TAKE from this design (implement in my project)
1. **The entire Home / landing page**, exactly as in the prototype: the hero (headline, subhead, two CTA buttons), the **animated neon-string band** (6 equidistant strings with elongated glowing beads travelling across), the **floating music-note glyphs** over the hero, and the **frozen bottom marquee** ticker.
2. **The full-screen overlay menu** and its trigger — the **animated equalizer "MENU" button** (4 bars that "breathe", morph to an ✕ when open). Menu fades in AND out, locks page scroll while open.
3. **Fonts** (apply app-wide, replacing current fonts).
4. **Background gradient mesh** (apply app-wide).
5. **Glow cursor** (the soft radial light that follows the pointer).
6. **Footer** (FAQ accordion + contact line + Terms/Privacy).
7. **The animated menu icons** (capo-clamp, sheet-note, strum-vibrate, tuner-sweep, magic-hands, audio-EQ, home-door) — reused both in the overlay menu AND in my project's existing top navbar (see KEEP #2).
8. **The light/dark theme system + tokens** (persisted, no-flash on load).

### 🛑 KEEP from my project (do NOT replace)
1. **Module UIs for Sheet Transposer, Strumming Studio, and Guitar Tuner** — keep my current implementations untouched.
2. **The top horizontal navigation bar** — keep my project's existing navbar structure/styling. Only two changes to it: (a) give each item the matching **animated icon** from TAKE #7, and (b) use **full module names** ("Capo Calculator", not "Capo").
3. **Background floating music notes** — my project already renders random floating notes in the background; keep that animation.
4. **Cursor trailing music-notes animation** — keep my existing one.

### 🔀 COMBINE (both at once — additive, not replace)
- **Background:** use this design's gradient mesh **behind** my project's existing floating-note background animation. Both visible together.
- **Cursor:** show this design's glow cursor **and** my existing music-note cursor trail simultaneously.
- **Menu button visibility:** in the prototype the MENU button appears only on Home. In my project it must be **visible on every page** (Home + all modules), living alongside my existing top navbar. Clicking it always opens the same full-screen overlay menu.

---

## Fonts (TAKE #3)
Load via Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```
- **Bricolage Grotesque** — display / headings / large nav & menu labels (weight 600–700, tight tracking `-0.03em`).
- **Space Grotesk** — all UI / body text (weight 400–600). This is the default `body` font.
- **JetBrains Mono** — chords, tablature, timers, small labels/eyebrows (letter-spacing ~`.1–.24em` for caps labels).

## Theme tokens (TAKE #8)
Define as CSS custom properties on a root element; switch by a `data-theme="light|dark"` attribute. Default dark. Persist choice to `localStorage` ("gt-theme") and apply before first paint (no flash). Children reference `var(--x)` with dark fallbacks so they paint immediately.

**Dark:**
```
--bg:#0b0b0e; --bg2:#111117; --panel:#16161c; --panelHi:#1e1e26; --sunk:#08080b;
--text:#f3f3f6; --muted:#9a9aa7; --faint:#5f5f6b; --border:#262630; --borderHi:#34343f;
--accent:oklch(0.66 0.2 292); --accent2:oklch(0.72 0.19 292); --accentSoft:oklch(0.66 0.2 292 / .16);
--mint:oklch(0.83 0.14 168); --rose:oklch(0.72 0.19 12); --amber:oklch(0.82 0.14 78);
--shadow:0 12px 34px rgba(0,0,0,.5); --shadowSm:0 3px 12px rgba(0,0,0,.4);
--glow:0 0 0 1px oklch(0.66 0.2 292 / .5), 0 10px 34px oklch(0.66 0.2 292 / .32);
```
**Light:**
```
--bg:#eeece7; --bg2:#f6f4f0; --panel:#ffffff; --panelHi:#faf8f4; --sunk:#e6e3dc;
--text:#18181d; --muted:#63636e; --faint:#a2a0a8; --border:#e3e0d9; --borderHi:#d5d2ca;
--accent:oklch(0.54 0.2 292); --accent2:oklch(0.58 0.19 292); --accentSoft:oklch(0.54 0.2 292 / .12);
--mint:oklch(0.62 0.14 168); --rose:oklch(0.56 0.19 12); --amber:oklch(0.62 0.13 78);
```

## Background gradient mesh (TAKE #4 / COMBINE)
Fixed, full-viewport, `pointer-events:none`, behind content (z-index 0). Dark opacity 1, light ~0.55:
```css
background:
  radial-gradient(45vw 45vw at 12% 8%,  oklch(0.55 0.2 292 / .28), transparent 60%),
  radial-gradient(42vw 42vw at 90% 96%, oklch(0.62 0.14 210 / .22), transparent 60%),
  radial-gradient(34vw 34vw at 62% 44%, oklch(0.7 0.16 20 / .14),  transparent 60%);
```
A subtle dot-grid overlay sits above it: `radial-gradient(var(--border) 0.5px, transparent 0.5px); background-size:22px 22px; opacity:.4`.
→ Render my project's existing background floating-notes ON TOP of this mesh.

## Glow cursor (TAKE #5 / COMBINE)
A single fixed element created imperatively and appended to `document.body` (NOT part of the component tree — this avoids reconciliation loops). Follows `pointermove`. Disabled on touch (`hover: none`) and `prefers-reduced-motion`.
```
width:440px; height:440px; border-radius:50%; position:fixed; pointer-events:none;
transform:translate(-50%,-50%);
background:radial-gradient(circle, oklch(0.66 0.2 292 / .13), transparent 60%);  /* light: /.09 */
```
→ This runs alongside my existing note-trail cursor; both listen to the same pointer events.

## Home page (TAKE #1)
Vertically-centered hero that fits one viewport (`min-height: calc(100vh - <navbar height>)`, flex column, centered).
- **Eyebrow pill** (JetBrains Mono, 11px) with a mint status dot: "100% in your browser · zero latency · no accounts".
- **Headline** (Bricolage, `clamp(40px,7vw,92px)`, line-height .94, tracking -.045em): "Your whole guitar **toolkit**, in one tab." The word "toolkit" uses a gradient text fill `linear-gradient(105deg, var(--accent2), oklch(0.82 0.13 200), var(--mint))`.
- **Subhead** (`clamp(14px,1.5vw,17px)`, `var(--muted)`, max-width 520px).
- **Two CTAs:** primary solid `var(--accent)` ("Open the toolkit →"), secondary outlined ("✦ Try Magic Chords"). Primary lifts `translateY(-2px)` on hover.
- Entrance: elements fade+rise via `gt-reveal` (0.7–1s, staggered).

### Neon-string band (hero centerpiece)
A relative box `height: clamp(150px,20vw,220px)`, max-width ~1120px. Inside, an absolutely-positioned column (`display:flex; flex-direction:column; justify-content:space-between; padding:10px 0`) of **6 string rows** (equidistant). Each row:
- The string: 2px tall, `background: linear-gradient(90deg, transparent, var(--border) 10%, var(--border) 90%, transparent)`.
- A travelling **bead**: an absolutely-positioned span, `78px × 9px`, `border-radius:9px`, `background: radial-gradient(closest-side, <COLOR>, transparent)` where COLOR cycles `var(--accent2) / var(--mint) / var(--accent2) / var(--rose) / var(--mint) / var(--accent2)`. Animated left→right by `gt-pluck`, each with a different duration (5.5–7s) and delay for an organic feel.
```css
@keyframes gt-pluck { 0%{transform:translate(-90px,-50%);opacity:0} 12%{opacity:1} 88%{opacity:1} 100%{transform:translate(1180px,-50%);opacity:0} }
```
(Beads animate `transform`, never `left`, for performance.)

### Floating notes over hero (TAKE #1)
~7 note glyphs (♪ ♫ ♩ ♬) absolutely positioned at scattered %-coords, each softly fading in/out and drifting:
```css
@keyframes gt-notefloat { 0%{opacity:0;transform:translateY(14px) rotate(-8deg) scale(.7)} 22%{opacity:.85} 62%{opacity:.6} 100%{opacity:0;transform:translateY(-30px) rotate(6deg) scale(1.05)} }
```
Styled with `text-shadow:0 0 16px <color>` glow, durations 7–9s, staggered delays.
(Note: this is the hero note layer. It is separate from my project's *background* note layer, which is kept per COMBINE.)

### Frozen marquee (TAKE #1)
A `position:fixed; bottom:0; left:0; right:0` bar (blurred translucent bg) with a horizontally-scrolling JetBrains-Mono ticker of module names + tags ("CAPO CALCULATOR • SHEET TRANSPOSER • … ZERO LATENCY • FULLY PRIVATE …"), looped seamlessly via `gt-drift` (translateX 0 → -50% over ~28s, list duplicated). Add bottom padding to page content so nothing hides behind it.

## Full-screen overlay menu (TAKE #2)
- **Trigger button** ("MENU"): a stack of a 42px rounded square button with the word **MENU** (JetBrains Mono, 7.5px, letter-spacing .22em) beneath it. Inside the button: 4 vertical bars (`3px` wide, heights 11/17/8/14, colors accent2/mint/rose/accent2) that continuously "breathe":
```css
@keyframes gt-eqbar { 0%,100%{transform:scaleY(.4)} 50%{transform:scaleY(1)} }
```
Each bar has a staggered delay (0/.18/.36/.54s). When the menu is open the bars are replaced by an ✕ (two 19px bars rotated ±45°). Button must be visible on EVERY page (COMBINE), placed next to my existing navbar.
- **Overlay:** full-viewport, **opaque** `background: var(--bg)` (NOT transparent) with a soft accent radial glow + the dot-grid on top. Fades in/out via opacity+visibility transition (~0.32s). While open, set `document.body.style.overflow='hidden'` (scroll-lock), restore on close. Esc and clicking the ✕ close it.
- **Items** (left-aligned, big): Home, Capo Calculator, Sheet Transposer, Strumming Studio, Guitar Tuner, Magic Chords (badge "FLAGSHIP"), Audio → Chords (badge "SOON"). Label font Bricolage `clamp(30px,5.2vw,60px)`, weight 600, with a thin bottom divider between rows and a staggered entrance (`gt-itemin`). On hover: row shifts `translateX(12px)`, label gains the accent→mint gradient text fill + shimmer (`gt-shimmer`), and the item's icon animates (below).
- Each item has its animated icon on the left (see next section). Selecting an item routes to that page and closes the menu.

## Animated icons (TAKE #7 — used in BOTH the overlay menu and my top navbar)
Small 34px line-SVGs (`stroke: currentColor`), colored `var(--muted)` at rest → `var(--accent)` on parent hover. On hover the icon plays a bespoke animation. Exact SVG geometry is in the prototype `<style>` + markup — copy the paths/rects and these keyframes:
- **Home** — a door that opens: door panel `scaleX(1)→scaleX(.12)`, `transform-origin` left edge. `@keyframes gt-ic-door {0%{transform:scaleX(1)}100%{transform:scaleX(.12)}}`
- **Capo Calculator** — a capo bar clamping across a horizontal fretboard: bar slides in on X. `@keyframes gt-ic-capo {0%{transform:translateX(8px);opacity:.3}55%{transform:translateX(0);opacity:1}72%{transform:translateX(-1px)}100%{transform:translateX(0)}}`
- **Sheet Transposer** — a note bobbing on a music sheet: `@keyframes gt-ic-note {0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}` (loops on hover).
- **Strumming Studio** — 4 vertical strings vibrating: `@keyframes gt-ic-vibe {0%,100%{transform:translateX(0)}50%{transform:translateX(1.3px)}}` (per-string stagger).
- **Guitar Tuner** — a needle sweeping over a gauge arc: `@keyframes gt-ic-sweep {0%{transform:rotate(-34deg)}50%{transform:rotate(34deg)}100%{transform:rotate(-34deg)}}`, `transform-origin` at the needle pivot.
- **Magic Chords** — two hands (palm + one raised finger) swivelling separately: `@keyframes gt-ic-hands {0%{transform:rotate(-20deg)}50%{transform:rotate(20deg)}100%{transform:rotate(-20deg)}}`, each hand rotates about its own origin with a .5s offset.
- **Audio → Chords** — equalizer bars dancing: reuse `gt-eqbar` on 3 bars with staggered delays.
All are triggered by `:hover` on the containing row/nav-item (e.g. `.item:hover .anim-capo { animation: … }`).

## My top navbar changes (KEEP #2 + reuse TAKE #7)
Keep my navbar's existing container/layout/colors. For each nav item: prepend the matching animated icon above, and show the **full module name** ("Capo Calculator", "Sheet Transposer", "Strumming Studio", "Guitar Tuner", "Magic Chords", "Audio → Chords"). Also place the MENU button here so it's present on all pages.

## Footer (TAKE #6)
Full-width, top border, `var(--bg2)` background. Contents:
- "FREQUENTLY ASKED" label (mono, faint).
- An **accordion** of FAQ rows (question + `+` icon that rotates 45° to ✕ when open; answer expands below). 3 items in the prototype (privacy, capo-voicing, performance) — reuse/replace copy as appropriate.
- Bottom row: brand mark + name, a "Contact hello@fretwork.app" mailto line, and "Terms" / "Privacy" placeholder links.

## Motion / accessibility
- All looping/entrance animations must be disabled under `@media (prefers-reduced-motion: reduce)`.
- Glow cursor hidden on touch and reduced-motion.
- Keep focus states and ARIA labels on the MENU button (`aria-expanded`), overlay, and accordion.

## Design tokens summary
- Colors: see Theme tokens above.
- Radii: buttons/inputs ~11–15px; cards ~18–22px; pills ~20–30px.
- Type scale: hero `clamp(40px,7vw,92px)`; menu items `clamp(30px,5.2vw,60px)`; body 13–17px; mono labels 9–12px.
- Shadows/glow: `--shadow`, `--shadowSm`, `--glow` tokens above.

## Assets
No raster assets. All visuals are CSS/SVG. Icons are inline SVGs (copy from the prototype). Fonts via Google Fonts link above.

## Files in this bundle
- `Guitar Toolkit.dc.html` — full prototype (authoritative source for exact markup, inline styles, and all `@keyframes`). Ignore the `<x-dc>` / `support.js` scaffolding — it's the prototype runtime, not part of the design.
- `ChordDiagram.dc.html` — chord-diagram sub-component (out of scope, reference only).
