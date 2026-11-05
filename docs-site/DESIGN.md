---
name: Setareh Docs
description: Public documentation for Setareh, set in the 2026 rebranding: one terracota accent for what can be clicked, tonal café neutrals over cream, light and dark.
colors:
  bg: "#f6eedf"
  surface: "#ffffff"
  subtle: "#f1e6d2"
  border: "#dccdb2"
  text: "#2b1e16"
  text-2: "#6a5646"
  text-3: "#8c7a68"
  link: "#9a4421"
  accent: "#a84b24"
  accent-hover: "#b5532a"
  on-accent: "#f6eedf"
  logo: "#b5532a"
  code-bg: "#33261d"
  code-text: "#f3e9d8"
  code-border: "#4a382b"
  code-accent: "#e08a5e"
  ok: "#1e7a4c"
  ok-bg: "#e3f3ea"
  warn: "#8f5b00"
  warn-bg: "#fbf1dc"
  err: "#b42318"
  err-bg: "#fdecea"
  dark-bg: "#1e1611"
  dark-surface: "#2a1f18"
  dark-subtle: "#33261d"
  dark-border: "#4a382b"
  dark-text: "#f3e9d8"
  dark-text-2: "#c9b9a3"
  dark-link: "#e08a5e"
  dark-accent: "#e08a5e"
  dark-on-accent: "#1e1611"
  dark-warn: "#f4c25b"
  dark-warn-bg: "#2a2410"
  dark-err: "#ff8a80"
  dark-err-bg: "#2e1414"
  dark-ok: "#7bd3a0"
  dark-ok-bg: "#17301f"
typography:
  display:
    fontFamily: "'Fraunces Variable', Fraunces, Georgia, serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1.0833
    letterSpacing: "-0.02em"
  display-sm:
    fontFamily: "'Fraunces Variable', Fraunces, Georgia, serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.1111
    letterSpacing: "-0.02em"
  h2:
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2857
    letterSpacing: "-0.01em"
  h3:
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  lead:
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.5556
  body:
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
  small:
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4286
  button:
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  eyebrow:
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4286
    letterSpacing: "0.06em"
  data:
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5714
rounded:
  badge: "6px"
  item: "8px"
  card: "12px"
  panel: "16px"
  pill: "999px"
spacing:
  nav-height: "4.5rem"
  nav-pad-x: "2rem"
  sidebar-width: "16.5rem"
  content-width: "52rem"
  content-pad-x: "3.5rem"
  section-top: "2.5rem"
  card-gap: "1.25rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0.5625rem 1.125rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    borderColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0.5625rem 1.125rem"
  search-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-2}"
    borderColor: "{colors.border}"
    rounded: "{rounded.pill}"
    height: "2.5rem"
  sidebar-item:
    textColor: "{colors.text}"
    typography: "{typography.small}"
    rounded: "{rounded.item}"
    padding: "0.4375rem 0.75rem"
  sidebar-item-current:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.link}"
    rounded: "{rounded.item}"
  toc-item:
    textColor: "{colors.text-2}"
    borderColor: "{colors.border}"
    padding: "0.3125rem 0 0.3125rem 0.75rem"
  toc-item-current:
    textColor: "{colors.link}"
    borderColor: "{colors.link}"
  card:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    rounded: "{rounded.panel}"
    padding: "1.5rem"
  callout:
    rounded: "{rounded.card}"
    padding: "1rem"
    typography: "{typography.small}"
  badge:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.badge}"
    padding: "0.125rem 0.5rem"
  table:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    rounded: "{rounded.card}"
  code-block:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.code-text}"
    typography: "{typography.data}"
    rounded: "{rounded.card}"
  inline-code:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.text}"
    rounded: "{rounded.badge}"
    padding: "0.125em 0.4em"
  pagination-card:
    borderColor: "{colors.border}"
    rounded: "{rounded.card}"
    padding: "1rem"
---

# Design System: Setareh Docs

## Overview

**Creative North Star: "Terracota y crema"**

The 2026 rebranding (Figma: "Setareh — Rebranding", pages 01 Logo, 02 Colores y tipografía, 07 Docs) takes the retro editorial warmth of a finance landing rather than the electric blue of payments, crypto and devtools. One accent, terracota, appears only on what can be clicked: the primary button, links, the active navigation item and focus. Everything else is a tonal café ramp over cream. State colours (success, warning, error) only mark real states. The emblem is Pau's lion-and-sun vector, recoloured: Setareh means star, and the sun is the star.

Fraunces is reserved for large titles (page titles, the wordmark, the 404). Everything else is Inter at 14 px or above: body, UI, eyebrows in capitals, and data (code, hashes, transactions) in Inter Medium with tabular figures. There is no monospace face.

Light is the default and the positive brand version; dark is the negative version (light terracota on café) and ships with it. The reader toggles with one round button; the choice is stored under Starlight's key.

**Key Characteristics:**
- One accent, only interactive. Terracota is never decorative text or a background wash.
- Tonal neutrals: café ink, two muted cafés, a cream line, three cream fills.
- Rounded containers: 6 px badges, 8 px nav items, 12 px cards and code, 16 px panels, pills for buttons and the search field.
- Flat. No shadows except the search dialog; no gradients, no grain, no glow.
- Code is always dark café, in both themes.
- Motion is one 120 ms colour transition on hover and a short rise for the search dialog and mobile menu.

## Colors

### Accent (interactive only)
- **Terracota 600** (accent): primary button and focus ring in light.
- **Terracota 700** (link): links and the active nav item in light.
- **Terracota 500** (accent-hover): button hover; also the emblem's positive fill (logo).
- **Terracota 300** (dark-link, dark-accent, code-accent): button, links, focus and the active nav item in dark; the active tab indicator in code blocks in both themes.

### Neutrals
- **Café tinta** (text): primary text.
- **Café gris 600** (text-2): secondary text, eyebrows, badges, icons, placeholders, table headers.
- **Café gris 500** (text-3): tertiary, decorative, hover borders.
- **Crema línea** (border): borders and dividers.
- **Crema tostado** (subtle): badge, inline code, active nav, callout note and the site footer.
- **Crema arena**: reserved (not used in the site).
- **Crema papel** (bg): page background.
- **Blanco** (surface): cards, tables, the search field and dialog.
- Dark: café 950 (dark-bg) page, café 900 (dark-surface) cards, café sutil oscuro (dark-subtle) fills, café 800 (dark-border) borders, crema (dark-text) text, café gris 300 (dark-text-2) secondary.

### State
- **Éxito** (ok / ok-bg): `created`, success insignias, the tip aside.
- **Aviso** (warn / warn-bg): testnet notice, `payment_unknown`, `manual_review`, confirmation badges, the caution aside.
- **Error** (err / err-bg): `expired`, `payment_failed`, `out_of_stock`, the danger aside.

### Named Rules
**The Only-Interactive Rule.** If terracota is on it, it can be clicked. If it cannot be clicked, it is café or cream.

**The Real-State Rule.** Green, amber and red only mark a real quote state or a real warning; never emphasis.

**The Dark Code Rule.** Code blocks keep the café surface and crema text in both themes; only the tab indicator is terracota.

## Typography

**Display Font:** Fraunces Variable (SOFT 0, WONK 1, optical size 144 on titles, 72 on the wordmark)
**UI and Body Font:** Inter Variable

Both are self-hosted through @fontsource-variable. Tabular numerals are on site-wide.

### Hierarchy
- **Display** (Fraunces 600, 3rem/3.25rem, -2%): page titles and the 404; 2.25rem below 50rem.
- **Wordmark** (Fraunces 600, 2.25rem desktop / 1.75rem mobile, -2%): "Setareh" in the masthead.
- **H2** (Inter 600, 1.75rem/2.25rem, -1%): content sections, "Secciones".
- **H3** (Inter 600, 1.25rem/1.75rem): card titles, subsections.
- **Lead** (Inter 400, 1.125rem/1.75rem, text-2): the first paragraph of every page and the home description.
- **Body** (Inter 400, 1rem/1.625rem).
- **Small** (Inter 400/500, 0.875rem/1.25rem): sidebar, TOC, breadcrumbs, callouts, tables, cards, pagination, footer. Nothing is set below 0.875rem.
- **Eyebrow** (Inter 600, 0.875rem, +6%, uppercase, text-2): sidebar group names, "En esta página", figure captions, "Error 404".
- **Data** (Inter 500, 0.875rem/1.375rem, tabular): code blocks, inline code, state insignias, hashes.

### Named Rules
**The Fraunces-Only-Large Rule.** Fraunces never appears below 2.25rem.

**The 14 px Floor.** No text smaller than 0.875rem.

## Layout

Masthead 4.5rem (3.5rem mobile) with the emblem, wordmark and "Docs" pill left; search pill, theme toggle and the "Empezar" primary button right. Sidebar 16.5rem with a 1px cream rule; content column 52rem with 3.5rem side padding; right rail with the page index. Mobile: the search collapses to an icon, the menu toggle is a bordered circle, the sidebar is a drawer with "Empezar" and the theme toggle pinned to its bottom, and the page index becomes Starlight's dropdown bar.

Home: title, lead, the testnet notice, "Secciones" as a 2-column grid of cards (1 column below 36rem), then "Qué es Setareh" and the five-step "Flujo". Doc pages: breadcrumb (Docs › group › page), title, lead, content, pagination cards, then the edit link and last-updated rule, then the site footer.

## Elevation & Depth

Flat. Cards and tables are white on cream with a 1px line; dark mode uses café 900 on café 950. The only shadow is under the search dialog.

## Shapes

Badges 6px, nav items 8px, cards, code blocks, callouts and pagination 12px, section cards and figures 16px, buttons, pills and the search field fully round. Bullets are 5px café dots; numbered steps are 1.75rem cream circles with a cream line.

## Components

### Masthead
Emblem 2rem in terracota 500 (terracota 300 in dark), "Setareh" in Fraunces, "Docs" pill in subtle. Search: 20rem pill on surface with a magnifier, placeholder "Buscar en la documentación" and a ⌘K key. Theme toggle: 2.5rem bordered circle, moon in light, sun in dark. "Empezar" primary pill links to Primeros pasos.

### Sidebar
"Inicio de la documentación" then four eyebrow groups: Empezar, Integrar, Operar, Verificar. Items 0.875rem, hover subtle fill, current subtle fill with link colour and medium weight. No carets.

### Page index
"En esta página" eyebrow; items with a 2px cream left rule, current in link colour with a link-coloured rule. The page title entry is hidden.

### Callouts
12px bordered cards: note (subtle, cream line), caution (warn), danger (err), tip (ok). Icon 1.25rem in the state colour, title medium in text, body small.

### Insignias
Neutral (subtle), ok, warn, err; 6px, 0.125rem 0.5rem padding, Inter 500 small. Quote states in the first column of tables become insignias automatically.

### Code
Café block, 12px, no border; a 2.5rem bar with the language tab (2px terracota 300 underline) and the copy button; lines in Inter Medium 0.875rem/1.375rem.

### Tables
White card, 12px, cream line; header row on subtle in text-2; 0.875rem padding; rows stack into labelled entries below 50rem.

### Lifecycle figure
Subtle 16px panel: "Camino normal" chips in a row with arrows, `created` in ok; "Estados de excepción" as err and warn insignias. Chips and table rows highlight each other on hover.

### MCP tools
White card list: numbered circle, tool name as a link, purpose in text-2, effect insignia (neutral for read-only, warn when confirmation is required).

### Verify steps
Subtle 16px panel with three numbered steps.

### Pagination and doc footer
Two 12px bordered cards (Anterior / Siguiente, label in text-2, title in link); below them a cream rule with "Editar esta página" (pencil, link) and "Última actualización" (text-2).

### Site footer
Subtle band with a cream rule: "© año Setareh · Solo Stellar testnet" and GitHub / llms.txt links.

### 404
Eyebrow "Error 404", Fraunces title, lead, secondary pill "Volver al inicio", a rule, and "Páginas principales".
