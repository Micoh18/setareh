---
name: Setareh Docs
description: Public documentation for Setareh, set as a film cutting bench flattened into a sheet.
colors:
  void: "#0b0b0a"
  charred: "#171614"
  spool: "#2b2926"
  flag: "#e6561b"
  flag-deep: "#a63a0b"
  flag-on-void-text: "#ee6a33"
  flag-light: "#f4a57f"
  flag-wash-frame: "#3a1a0c"
  flag-wash-window: "#fbe6dc"
  window: "#ffffff"
  edge: "#f1efea"
  ink: "#141311"
  ink-muted: "#57534c"
  hairline: "#d9d5cc"
  on-void-muted: "#a8a39a"
typography:
  display:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(2.25rem, 4.5vw, 3.25rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.65
  frame-title:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.05
  nav:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    letterSpacing: "0.08em"
  label:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    letterSpacing: "0.1em"
  code:
    fontFamily: "'JetBrains Mono', ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
rounded:
  none: "0px"
spacing:
  rail-gap: "0.625rem"
  frame-gap: "1.5rem"
  window-inline: "clamp(1.25rem, 5vw, 4.5rem)"
  section-top: "2.5rem"
components:
  masthead-tab:
    textColor: "{colors.edge}"
    typography: "{typography.nav}"
    padding: "0.25rem 0"
  masthead-tab-active:
    textColor: "{colors.flag}"
    typography: "{typography.nav}"
  sidebar-folio:
    textColor: "{colors.edge}"
    typography: "{typography.nav}"
    rounded: "{rounded.none}"
    padding: "0.4rem 0.75rem"
  sidebar-folio-current:
    backgroundColor: "{colors.flag}"
    textColor: "{colors.void}"
    rounded: "{rounded.none}"
    padding: "0.4rem 0.75rem"
  rail-frame:
    backgroundColor: "{colors.window}"
    textColor: "{colors.ink}"
    typography: "{typography.frame-title}"
    rounded: "{rounded.none}"
    padding: "1.1rem 1.1rem 0.9rem"
    height: "8.75rem"
  hung-tag:
    backgroundColor: "{colors.edge}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.6rem 0.6rem 0.7rem"
  hash-action:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.3rem 0.6rem"
  hash-action-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.window}"
  menu-trigger:
    backgroundColor: "transparent"
    textColor: "{colors.flag}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.45rem 0.8rem"
  menu-trigger-open:
    backgroundColor: "{colors.flag}"
    textColor: "{colors.void}"
  search-field:
    backgroundColor: "{colors.charred}"
    textColor: "{colors.on-void-muted}"
    rounded: "{rounded.none}"
  code-block:
    backgroundColor: "{colors.void}"
    typography: "{typography.code}"
    rounded: "{rounded.none}"
  inline-code:
    backgroundColor: "{colors.edge}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.1em 0.35em"
---

# Design System: Setareh Docs

## Overview

**Creative North Star: "Mesa de corte"**

The site is a film cutting bench flattened into a sheet. The quote, confirmation, settlement and order trace is a perforated rail of frames, and every page is a frame on that rail. A true-black frame, inked in grainy flag orange, owns the masthead, the rail, the sidebar, section openers and the chrome of code and tables. Running copy lives only in punched white windows set into that frame, in a calm book serif. Labels speak in one condensed grotesk, always in capitals; mono appears only for code, identifiers and hashes.

State is a mark, never a hue. Done, verified, pending and closed are told apart by a small set of physical marks (a grease-pencil cross, an eight-point registration star, a tag hung on a pin, a punched corner), not by green/amber/red badges. The single accent is one ink at two strengths: bright flag on black, deep flag on white. There are no gradients, no glow and no light mode: the frame is always black and the window is always white.

Density is that of a working reference sheet: generous measure in the window (46rem content width on inner pages, 68ch on the home), tight and ruled in tables, loud and condensed in labels.

**Key Characteristics:**
- One ink: flag orange in grain on true black owns the frame; white windows hold the reading.
- Starlight's tokens are remapped at the root for the frame and flipped again inside every reading window.
- State marks (cross, star seal, pin, punched corner, folded tape flag) instead of colored badges.
- Square corners everywhere; borders are rules, perforations and tape, never rounded containers.
- Single theme; the theme selector is intentionally empty.
- One motion: hung tags settle once on load, and only when motion is allowed.

## Colors

One warm-black frame, one flag-orange ink at two strengths, and paper neutrals for the window.

### Primary
- **Flag Orange** (flag): the frame's ink. Rail background (with grain), perforated top edge of every reading window, tape strip before every section heading, 4px top rule of tables, 6px top border of code frames, current-page fill in the sidebar, active masthead tab, focus ring, text selection. On black only, or as a solid field; never as running text on white.
- **Deep Flag** (flag-deep): the same ink where it must read on white. Links, the verified star seal, hash-public labels, numerals in step lists and tool tables, hover on door links and pagination titles. Starlight's accent and text-accent resolve to it inside the window.
- **Flag on Void Text** (flag-on-void-text), **Flag Light** (flag-light), **Frame Wash** (flag-wash-frame), **Window Wash** (flag-wash-window): Starlight-derived accent steps only (accent-high, accent-low, text-accent on the frame and in the window). Not for authored components.

### Neutral
- **True Void** (void): the frame. Page, masthead, sidebar, asides, code block background, the verify-steps tray and the lifecycle figure. Also the perforation holes cut through flag strips.
- **Charred** (charred): one step up from void. Search field, inline code on the frame, editor tab bars, mobile table-of-contents trigger.
- **Spool** (spool): frame hairlines. Masthead bottom rule, menu borders, code-frame borders, scrollbar thumb.
- **Window White** (window): the punched reading window and the rail frames.
- **Edge** (edge): off-white for primary text on the frame and for tinted surfaces in the window (inline code, blockquotes, hash boxes, hung exception tags).
- **Ink** (ink): text in the window; heavy rules (table top on stacked rows, door tops, pagination tops); the cross mark.
- **Ink Muted** (ink-muted): secondary text and table headers in the window.
- **Hairline** (hairline): row rules in ledgers inside the window.
- **On-Void Muted** (on-void-muted): secondary text on the frame (sidebar folio numbers, right-sidebar links, captions, terminal titles).

Grain is a token, not a color: an SVG fractal-noise tile (160px, 22% alpha) layered under every flag-orange field (rail, perforations, tape strips, sprockets). Flag fields without grain are plain fills (current-page highlight, menu open state, edge codes).

### Named Rules
**The One Ink Rule.** Flag orange is the only chromatic color. On black it is used bright; on white it is used deep. No second accent is ever introduced.

**The Window Flip Rule.** Every reading surface redeclares Starlight's gray ramp, text, accent, background, hairline and orange tokens to their window values, because derived Starlight tokens resolve at the root. A new reading surface either sits inside an existing window selector or carries the window class; it never inherits frame tokens on white.

**The State-Is-A-Mark Rule.** No state is ever encoded by hue alone. Done, verified, pending and closed each have a shape.

## Typography

**Display Font:** Literata (with Georgia, Times New Roman, serif)
**Body Font:** Literata (with Georgia, Times New Roman, serif)
**Label Font:** Barlow Condensed (with Arial Narrow, sans-serif)
**Mono Font:** JetBrains Mono (with ui-monospace, monospace)

All three are self-hosted through @fontsource: Barlow Condensed 600/700, Literata 400/400 italic/600, JetBrains Mono 400/500. Body text uses tabular numerals throughout.

**Character:** A patient book serif for everything a person reads at length, against a loud condensed grotesk in capitals for everything a person scans: frame titles, doors, labels, navigation. Mono is reserved for what is copied.

### Hierarchy
- **Display** (Literata 600, clamp(2.25rem, 4.5vw, 3.25rem), 1.1): the home H1 inside the punched window, max 34ch.
- **Headline** (Literata 600, 3rem, 1.15, -0.02em): inner page titles. Balanced wrap.
- **Title** (Literata 600, 1.625rem h2 / 1.3125rem h3 / 1.125rem h4, 1.15, -0.01em): section headings in content, 2.5rem above, 0.75rem below.
- **Body** (Literata 400, 1.0625rem, 1.65): running copy, pretty wrap. Home lede at 1.25rem/1.6, max 52ch.
- **Frame Title** (Barlow Condensed 700, 2rem, 1.05, uppercase): rail frame titles (1.75rem narrow), door titles (clamp(2rem, 3vw, 2.5rem)), pagination titles (1.75rem), step numerals (2.25rem).
- **Nav** (Barlow Condensed 600, 1rem to 1.125rem, 0.06em to 0.08em, uppercase): masthead tabs, sidebar folios, door links, menu items.
- **Label** (Barlow Condensed 600, 0.75rem to 0.875rem, 0.1em to 0.12em, uppercase): table headers, sidebar group names and the on-this-page heading (in flag), aside titles, figure captions, legends, the limits line, hash actions.
- **Code** (JetBrains Mono 400/500, 0.875rem; 0.75rem for frame details and folio numbers): code blocks, inline code, identifiers, hashes, sidebar folio counters.

### Named Rules
**The Read-Or-Scan Rule.** If it is read in sentences, it is Literata. If it is scanned, it is Barlow Condensed in capitals. If it is copied, it is JetBrains Mono. No fourth face.

**The Unbroken Identifier Rule.** An identifier alone in a table's first column never wraps mid-token; hashes elsewhere may break anywhere because they are copied, not read.

## Layout

Two planes: the black frame at full bleed and the white window set into it. On inner pages the window is the main column (46rem content width) with 1.5rem margin from the frame on wide screens, a perforated flag edge across its top, and the sidebar and right rail living on black. On the home the rail runs full bleed across the viewport (inner measure 82rem, gutter clamp(1rem, 5vw, 5.75rem)), and everything after it sits in one punched window 78rem wide whose children cap at 68ch.

The rail is a horizontal grid of frames (min 15rem each, 1.5rem gap) on a grainy flag field, bracketed by sprocket strips and numbered edge codes (01 to 04 in mono on flag tabs). It scroll-snaps horizontally when it overflows; on narrow screens frames take 78% width and edge codes drop.

Breakpoints observed: 40rem (MCP tool table rows become grids), 50rem (markdown tables stack into labelled entries, home rail compacts, window gains side margins above it), 62rem (masthead section tabs appear; below it the home gets its own menu). The lifecycle figure uses container queries: six columns, three under 52rem, one vertical rail under 30rem.

Spacing is ruled rather than scaled: 0.625rem for gaps inside dark trays and rails, 1.5rem between rail frames, 2rem before inserted figures, 2.5rem above section headings.

## Elevation & Depth

Flat. There are no drop shadows anywhere; Expressive Code's frame shadow is set to none and pagination shadows are removed. Depth is conveyed by the two planes (white window punched into black frame), by perforations that cut through flag strips to the void beneath, by grain on flag fields, and by the slight rotation of hung tags.

The lifecycle's normal-state frames use a solid flag band above and below (drawn with box-shadow offsets) to read as sprocket film; this is a rail band, not elevation, and drops away on the single-column layout.

### Named Rules
**The No-Glow Rule.** No gradients for atmosphere, no glow, no blur, no soft shadow. The only gradients in the build are hard-stop repeats that cut perforations.

## Shapes

Every corner is square (0). Containers are defined by rules, not boxes: a 2px ink rule on top of pagination and stacked table rows, a 4px flag rule on top of tables, a 6px ink rule on top of doors, a 0.375rem flag rule on top of code frames. Dashed 1.5px ink borders mean a note pinned to the sheet (blockquotes, exception tags). Outlined 1.5px borders mark controls (menu trigger, hash actions).

The mark grammar:
- **Grease cross**: two hand-drawn crossing strokes, round caps, in ink. Done in the reference flow.
- **Eight-point star with punched center**: the wordmark's registration punch, reused as the verified seal. Verifiable by public hash.
- **Pin and hung tag**: a flag-orange pin dot above an edge-colored tag rotated a few degrees. Pending, deferred, or an exception branching from a state.
- **Punched corner**: a solid ink triangle in the top-right corner. Closed without an order.
- **Folded tape flag**: a void pentagon notch hanging over the current sidebar entry. Where you are.
- **Tape strip**: a 2.5rem by 0.375rem grainy flag strip before every content h2. Section opener.
- **Perforation**: void rectangles repeating across a grainy flag strip. The edge of a frame or window.

## Components

### Masthead
- **Style:** void bar, 4.25rem tall, spool rule beneath. Star mark in flag, SETAREH wordmark in Barlow Condensed 700 edge, DOCS in flag label.
- **Tabs:** four section tabs (Empezar, Integrar, Operar, Evidencia) in nav type, edge; hover flag; active flag with a 2px flag underline. Shown from 62rem.
- **Mobile:** on the home only, a MENÚ trigger outlined in flag that fills flag when open; its panel is void with spool rules and a flag-filled current item. Elsewhere Starlight's menu button is restyled square, transparent, outlined in flag.
- **Search:** charred field with spool border, mono placeholder in on-void-muted, the shortcut in flag label; border turns flag on hover.

### Sidebar folios
- **Style:** each link is a numbered folio: a mono counter (00, 01...) in on-void-muted before an uppercase nav label in edge. Group names are flag labels.
- **Current page:** solid flag fill with void text and counter, plus the folded tape flag notch at the top right.
- **Hover:** text turns flag.

### Rail frames (signature)
- **Style:** white frames on the grainy flag rail, square, 8.75rem min height, frame title top-left, mono detail pinned to the bottom in ink-muted, state mark top-right.
- **Verified frame:** a 3px void inset outline and the deep-flag star seal; its detail is a link to the evidence.
- **Pending:** a hung tag below the rail on a pin, outside the rail itself.

### Lifecycle figure
- **Style:** void tray holding a rail of state frames (window white, flag sprocket bands); exceptions hang below their source state as dashed edge tags on flag pins, alternately rotated; closed-without-order exceptions carry the punched corner. A caption in labels states the key.
- **Narrow:** collapses to a single vertical rail with perforated flag margins, pins moving to the left side.

### Doors
- **Style:** two side-by-side sections in the home window, each topped by a 6px ink rule, with a Barlow 700 title, a muted Literata line, and a list of nav-type links in ink with a stroked arrow that nudges 3px right on hover (200ms, cubic-bezier(0.16, 1, 0.3, 1)). Hover text is deep flag.

### Ledgers (tables)
- **Style:** full width, collapsed, 4px flag top rule, hairline row rules, no zebra, no cell backgrounds. Headers in muted uppercase labels.
- **Narrow (under 50rem):** rows become stacked entries, each topped by a 2px ink rule, every cell preceded by its column name as a label. The MCP tool table does the same under 40rem.

### Code
- **Blocks:** void sheets inside the window, square, spool border, 0.375rem flag top border, no shadow. Editor tabs: charred bar, active tab solid flag with void text. Terminal title in on-void-muted on charred. Copy button outlined in flag.
- **Inline:** edge background, ink text, square, 0.875em.

### Hash evidence
- **Style:** a full 64-character hash in an edge box (mono, breaks anywhere), preceded by the star seal and a "Hash público" label in deep flag, followed by outlined square actions (Copiar hash, Horizon, Explorador) that invert to ink on hover.

### Asides and quotes
- **Asides:** void panels inside the window with edge text and flag uppercase titles and links.
- **Blockquotes:** edge background, dashed 1.5px ink border, upright text: a note pinned to the sheet.

### Pagination
- **Style:** no box; a 2px ink rule on top, Barlow 700 uppercase title at 1.75rem in ink, deep flag on hover.

### Motion
- One settle: hung tags rotate from about -6deg to about -2deg over 900ms (cubic-bezier(0.16, 1, 0.3, 1)) once on load, only under prefers-reduced-motion: no-preference. With reduced motion they rest at their final angle. The door arrow nudge is the only hover motion.

## Do's and Don'ts

### Do:
- **Do** put every new reading surface inside a white window that flips Starlight's tokens; keep the frame void.
- **Do** lay grain under flag fields that act as material (rails, perforations, tape strips).
- **Do** mark state with the mark grammar: cross for done, star seal for publicly verifiable, pin and hung tag for pending or exception, punched corner for closed without an order, folded tape flag for the current page.
- **Do** use flag (#e6561b) for text and marks on black and flag-deep (#a63a0b) for text and marks on white; on white, bright flag appears only as solid rules, tape strips and pins.
- **Do** set scanned text in Barlow Condensed capitals, read text in Literata, copied text in JetBrains Mono.
- **Do** keep every corner square and define containers with top rules, perforations and dashed pinned borders.
- **Do** let tables stack into labelled entries below 50rem.
- **Do** honor reduced motion: hung tags rest at their final rotation with no animation.

### Don't:
- **Don't** add a light theme or a theme switcher; the site ships one theme.
- **Don't** encode status as a colored badge or by hue alone.
- **Don't** introduce gradients for atmosphere, glow, blur or soft drop shadows.
- **Don't** round corners on any component, including Starlight controls.
- **Don't** set long running copy on the black frame; black carries labels, captions, short notes (the home's limits note) and asides, while sustained reading belongs in a white window.
- **Don't** add a second accent color or a fourth typeface.
