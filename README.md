# SSB-WebRTC — Spec Posters Website

> **Audience**: AI coding agents.
> This README explains how to add new pages to the GitHub Pages website using
> the poster-template system and the source documentation.

---

## 1. Repository Layout

```
ssb-webrtc/
├── web-rtc.md              ← SOURCE DOC: general theoretical plan (~1220 lines)
├── web-rtc-ext.md          ← SOURCE DOC: extension document (1078 lines, 10 EXT sections)
├── web-rtc.png             ← Diagram referenced by web-rtc.md
├── PLAN_OASIS.md           ← Implementation plan (referenced by web-rtc.md)
├── index.js                ← App entry point
├── package.json            ← NPM config
├── signaling/              ← Signaling module
├── README.md               ← This file
└── docs/                   ← GitHub Pages root (deploy from /docs on main branch)
    ├── index.html           ← Landing page — links to all posters and specs
    ├── poster-arq3.html     ← Poster: Arq. 3 (go2rtc + Mumble + node-datachannel)
    ├── poster-arq6.html     ← Poster: Arq. 6 (µStreamer + Mumble + node-datachannel)
    ├── poster-csi-usb.html  ← Poster: CSI vs USB cameras (EXT-1 + EXT-2)
    ├── poster-glosario.html ← Poster: Glossary — 40 terms (§4 + EXT-8)
    ├── poster-protocolo.html ← Poster: WebRTC & Mumble protocol stacks (§1.1–1.5 + §1.7)
    ├── poster-ecosistema.html ← Poster: Libraries & servers ecosystem (§1.6 + §1.7)
    ├── poster-arq1.html     ← Poster: Arq. 1 (go2rtc relay integral, CSI + USB)
    ├── poster-arq2.html     ← Poster: Arq. 2 (MediaMTX + rpicam, CSI zero-copy)
    ├── poster-arq4.html     ← Poster: Arq. 4 (ffmpeg→HLS estático, baseline)
    ├── poster-arq5.html     ← Poster: Arq. 5 (RPi-WebRTC native, solo CSI)
    ├── poster-retransmision.html ← Poster: Browser retransmission (§2.1 + EXT-4)
    ├── poster-template/     ← Shared CSS + HTML skeletons
    │   ├── fanzine.css       ← Shared fanzine B/W stylesheet (405 lines)
    │   ├── template.html     ← Poster skeleton (170 lines) — copy for new posters
    │   ├── spec-template.html← Spec sub-file skeleton (74 lines) — copy for new specs
    │   └── README.md         ← Template-specific instructions (CSS classes, placeholders)
    ├── spec-arq3/           ← Deep-dive specs for Architecture 3
    │   ├── go2rtc.html
    │   ├── mumble-bridge.html
    │   ├── oasis-proxy.html
    │   ├── datachannel.html
    │   └── deploy.html
    ├── spec-arq6/           ← Deep-dive specs for Architecture 6
    │   ├── ustreamer.html
    │   ├── mumble-bridge.html
    │   ├── oasis-proxy.html
    │   ├── datachannel.html
    │   └── deploy.html
    ├── spec-arq1/           ← Deep-dive specs for Architecture 1
    │   ├── go2rtc.html
    │   └── deploy.html
    ├── spec-arq2/           ← Deep-dive specs for Architecture 2
    │   ├── mediamtx.html
    │   └── deploy.html
    ├── spec-arq5/           ← Deep-dive specs for Architecture 5
    │   ├── rpi-webrtc.html
    │   ├── media-proxy.html
    │   └── deploy.html
    └── spec-csi-usb/        ← Deep-dive specs for CSI vs USB
        ├── pipeline.html
        └── impact.html
```

---

## 2. Source Documentation

The website content is derived from two markdown files at the repo root:

### `web-rtc.md` — General Theoretical Plan

Covers WebRTC fundamentals and SSB/Oasis-specific application:
- §1 Transmisión — SDP signaling, ICE, STUN/TURN, codec negotiation, node-datachannel
- §2 Consumo — retransmission alternatives, media servers (go2rtc, MediaMTX, Janus), Arq. 3 hybrid
- §3 Implementación — Camino A (node-datachannel + ffmpeg), B (go2rtc), C (Mumble + go2rtc + datachannel)
- §4 Glosario

### `web-rtc-ext.md` — Extension Document (10 EXT Sections)

Extends `web-rtc.md` without repeating it (DRY patch):
- **EXT-1** CSI vs. USB camera comparison
- **EXT-2** Capture pipeline implications (extends §1.7)
- **EXT-3** RPi-WebRTC project overview
- **EXT-4** CSI/USB impact on §2.1 (browser retransmission)
- **EXT-5** CSI/USB + RPi-WebRTC impact on §2.2 (media servers)
  - EXT-5A Arq. 1 (go2rtc) with CSI/USB
  - EXT-5B Arq. 2 (MediaMTX) with CSI/USB
  - EXT-5C Arq. 3 (Mumble hybrid) with CSI/USB
  - EXT-5D Arq. 5 (RPi-WebRTC native)
- **EXT-6** Implementation impact: Caminos A, B, C + new Camino D
- **EXT-7** Unified decision matrix (CSI/USB × Architecture × RPi-WebRTC)
- **EXT-8** Glossary extension
- **EXT-9** µStreamer project overview
- **EXT-10** µStreamer impact on §2.2 — new Arq. 6
  - EXT-10A µStreamer as MJPEG alternative to go2rtc
  - EXT-10B Arq. 6 (µStreamer + Mumble, ultra-light)
  - EXT-10C µStreamer + Janus (WebRTC variant)

### What Has Been Converted So Far

| Source Section              | Website Page                     | Status |
|-----------------------------|-----------------------------------|--------|
| §2.2 Comparativa + EXT-7 Decision matrix | `poster-decision.html`   | ✅ Done |
| §2.2 Arq. 3 + §3 Camino C + EXT-5C | `poster-arq3.html` + `spec-arq3/` (5 files) | ✅ Done |
| EXT-10B Arq. 6 + EXT-9     | `poster-arq6.html` + `spec-arq6/` (5 files) | ✅ Done |
| §1.1–1.5 Protocol stacks + Mumble | `poster-protocolo.html`      | ✅ Done |
| §1.6 + §1.7 Ecosystem & alternatives | `poster-ecosistema.html`   | ✅ Done |
| §2.1 Retransmission alternatives | `poster-retransmision.html`       | ✅ Done |
| EXT-1/EXT-2 CSI vs USB      | `poster-csi-usb.html` + `spec-csi-usb/` (2 files) | ✅ Done |
| EXT-3/EXT-5D RPi-WebRTC (Arq. 5) | `poster-arq5.html` + `spec-arq5/` (3 files) | ✅ Done |
| §2.2 Arq. 1 (go2rtc) + EXT-5A | `poster-arq1.html` + `spec-arq1/` (2 files) | ✅ Done |
| EXT-5B Arq. 2 (MediaMTX)    | `poster-arq2.html` + `spec-arq2/` (2 files) | ✅ Done |
| §2.2 Arq. 4 (ffmpeg→HLS)     | `poster-arq4.html`               | ✅ Done |
| EXT-7 Decision matrix        | `poster-decision.html`           | ✅ Done |
| §4 + EXT-8 Glossary          | `poster-glosario.html`           | ✅ Done |

---

## 3. How to Create a New Poster Page

### Step 1 — Choose Source Material

Read `web-rtc.md` and/or `web-rtc-ext.md`. Pick an unconverted section from the table above (or a new one the user requests).

### Step 2 — Copy the Poster Skeleton

```bash
cp docs/poster-template/template.html docs/poster-arqN.html
```

### Step 3 — Fix the CSS Path

The template has `href="fanzine.css"` (for files inside `poster-template/`).
For a poster at `docs/` root level, change it to:

```html
<link rel="stylesheet" href="poster-template/fanzine.css">
```

### Step 4 — Replace All `{{PLACEHOLDERS}}`

Search-and-replace these in the new file:

| Placeholder | What to Put |
|---|---|
| `{{TITLE}}` | Browser tab title |
| `{{STAMP}}` | Top-right stamp label (e.g. "SOLAR NET HUB") |
| `{{POSTER_NAME}}` | Big `<h1>` name (e.g. "Arq. 5") |
| `{{SUBTITLE}}` | Main components list |
| `{{DESCRIPTION}}` | Short one-line description |
| `{{SOURCE_REF}}` | Source reference (e.g. "web-rtc-ext.md · EXT-5D") |
| `{{DEVICE}}` | Hardware target (e.g. "RPi 3B") |
| `{{STACK}}` | Stack summary for the footer |
| `{{ONE-LINE TAGLINE}}` | Callout phrase |

Fill in the content sections (architecture diagram, component cards, specs table,
troubleshooting, etc.) using information from the source markdown.

### Step 5 — Create Spec Sub-Files

For each major component, create a deep-dive spec:

```bash
mkdir -p docs/spec-arqN
cp docs/poster-template/spec-template.html docs/spec-arqN/component.html
```

In each spec file:
1. Fix CSS path to `../poster-template/fanzine.css`
2. Fix the "back to poster" link to `../poster-arqN.html`
3. Replace `{{COMPONENT_NAME}}`, `{{Component Name}}`, `{{One-line description}}`
4. Fill in: identity table, key concept, config/commands, troubleshooting

### Step 6 — Link Specs from the Poster

In `poster-arqN.html`, inside the `☞ Deep-Dive Specs` cutout, add:

```html
<a class="deep-link" href="spec-arqN/component.html">Component — short description</a><br>
```

### Step 7 — Update the Landing Page

Edit `docs/index.html` — add a new `<div class="poster-card">` block following the
existing pattern (Arq. 3 and Arq. 6 are examples). Include:
- Badge label (`<div class="badge">`)
- Title and meta line
- Main link to the poster
- Spec links in a `<div class="spec-list">`

---

## 4. Design Constraints

These apply to all pages:

| Constraint | Value |
|---|---|
| **Aesthetic** | Fanzine B/W — Courier New, black on white, no color, recortable |
| **Language** | Spanish (content language matches source docs) |
| **CSS** | Always link to `poster-template/fanzine.css` — never inline full styles |
| **JS** | Zero JavaScript — HTML/CSS only |
| **Target device** | RPi 3B · BCM2837 · 1 GB LPDDR2 · VideoCore IV · Solar 22W |
| **OS stack** | Yocto Poky 4.3.4 → Docker → Debian Bookworm |
| **App** | Oasis :3000 (Node.js / SSB) · zero JS in browser |
| **Audio** | murmurd :64738 (Mumble) · already installed |

---

## 5. CSS Classes Reference

Full reference is in `docs/poster-template/README.md`. Key classes:

**Layout**: `.header`, `.stats-bar`, `.cols` > `.col`, `.cutout`, `.diagram-wrap` + `.diagram`, `.callout`, `.washi`, `.footer`

**Components**: `.card` + `.card-title` + `.card-body` + `.card-port`

**Typography**: `.kw` (keyword black), `.kw-inv` (keyword white-on-black), `.hl-box` (highlight box)

**Info boxes**: `.tip`, `.warn`, `.key-concept`

**Navigation**: `.deep-link` (spec links), `.nav-back` (back to poster link)

**Decoration**: `.tape` (`.tape-tl`, `.tape-tr`), `.tilt-l`, `.tilt-r`

**Commands**: `.cmd` + `.prompt`

**Tables**: `.tbl`

**Collapsible**: `<details>` + `<summary>` (styled automatically)

---

## 6. Naming Conventions

- Posters: `docs/poster-arqN.html` where N is the architecture number
- Spec folders: `docs/spec-arqN/`
- Spec files: `docs/spec-arqN/component-name.html` (lowercase, hyphens)
- Non-architecture pages (e.g. glossary, overview): `docs/page-name.html`

---

## 7. Checklist for Adding a New Page

- [ ] Source material identified in `web-rtc.md` or `web-rtc-ext.md`
- [ ] Poster HTML created from `template.html` with all `{{PLACEHOLDERS}}` replaced
- [ ] CSS path points to `poster-template/fanzine.css` (relative to file location)
- [ ] Spec sub-files created from `spec-template.html` (one per major component)
- [ ] Each spec has correct CSS path (`../poster-template/fanzine.css`)
- [ ] Each spec has correct "back to poster" link
- [ ] Poster links to all its specs in the `☞ Deep-Dive Specs` section
- [ ] `docs/index.html` updated with new poster-card entry
- [ ] No JavaScript anywhere
- [ ] All content in Spanish
- [ ] Zero external dependencies (no CDN links, no Google Fonts)
