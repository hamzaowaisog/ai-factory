---
name: stitch-design-taste
description: Semantic Design System Skill for Google Stitch. Generates agent-friendly DESIGN.md files that enforce premium, anti-generic UI standards — strict typography, calibrated color, asymmetric layouts, perpetual micro-motion, and hardware-accelerated performance.
---

# Stitch Design Taste — Semantic Design System Skill

## Overview
This skill generates `DESIGN.md` files optimized for Google Stitch screen generation. It translates the battle-tested anti-slop frontend engineering directives into Stitch's native semantic design language — descriptive, natural-language rules paired with precise values that Stitch's AI agent can interpret to produce premium, non-generic interfaces.

The generated `DESIGN.md` serves as the **single source of truth** for prompting Stitch to generate new screens that align with a curated, high-agency design language. Stitch interprets design through **"Visual Descriptions"** supported by specific color values, typography specs, and component behaviors.

## Prerequisites
- Access to Google Stitch via [labs.google/stitch](https://labs.google/stitch)
- Optionally: Stitch MCP Server for programmatic integration with Cursor, Antigravity, or Gemini CLI

## The Goal
Generate a `DESIGN.md` file that encodes:
1. **Visual atmosphere** — the mood, density, and design philosophy
2. **Color calibration** — neutrals, accents, and banned patterns with hex codes
3. **Typographic architecture** — font stacks, scale hierarchy, and anti-patterns
4. **Component behaviors** — buttons, cards, inputs with interaction states
5. **Layout principles** — grid systems, spacing philosophy, responsive strategy
6. **Motion philosophy** — animation engine specs, spring physics, perpetual micro-interactions
7. **Anti-patterns** — explicit list of banned AI design clichés

## Analysis & Synthesis Instructions

### 1. Define the Atmosphere
Evaluate the target project's intent. Use evocative adjectives from the taste spectrum:
- **Density:** "Art Gallery Airy" (1–3) → "Daily App Balanced" (4–7) → "Cockpit Dense" (8–10)
- **Variance:** "Predictable Symmetric" (1–3) → "Offset Asymmetric" (4–7) → "Artsy Chaotic" (8–10)
- **Motion:** "Static Restrained" (1–3) → "Fluid CSS" (4–7) → "Cinematic Choreography" (8–10)

Default baseline: Variance 8, Motion 6, Density 4. Adapt dynamically based on user's vibe description.

### 2. Map the Color Palette
For each color provide: **Descriptive Name** + **Hex Code** + **Functional Role**.

**Mandatory constraints:**
- Maximum 1 accent color. Saturation below 80%
- The "AI Purple/Blue Neon" aesthetic is strictly BANNED — no purple button glows, no neon gradients
- Use absolute neutral bases (Zinc/Slate) with high-contrast singular accents
- Stick to one palette for the entire output — no warm/cool gray fluctuation
- Never use pure black (`#000000`) — use Off-Black, Zinc-950, or Charcoal

### 3. Establish Typography Rules
- **Display/Headlines:** Track-tight, controlled scale. Not screaming. Hierarchy through weight and color, not just massive size
- **Body:** Relaxed leading, max 65 characters per line
- **Font Selection:** `Inter` is BANNED for premium/creative contexts. Force unique character: `Geist`, `Outfit`, `Cabinet Grotesk`, or `Satoshi`
- **Serif Ban:** Generic serif fonts (`Times New Roman`, `Georgia`, `Garamond`, `Palatino`) are BANNED. If serif is needed for editorial/creative contexts, use only distinctive modern serifs: `Fraunces`, `Gambarino`, `Editorial New`, or `Instrument Serif`. Serif is always BANNED in dashboards or software UIs
- **Dashboard Constraint:** Use Sans-Serif pairings exclusively (`Geist` + `Geist Mono` or `Satoshi` + `JetBrains Mono`)
- **High-Density Override:** When density exceeds 7, all numbers must use Monospace

### 4. Define the Hero Section
The Hero is the first impression and must be creative, striking, and never generic:
- **Inline Image Typography:** Embed small, contextual photos or visuals directly between words or letters in the headline. Images sit inline at type-height, rounded, acting as visual punctuation. This is the signature creative technique
- **No Overlapping:** Text must never overlap images or other text. Every element occupies its own clean spatial zone
- **No Filler Text:** "Scroll to explore", "Swipe down", scroll arrow icons, bouncing chevrons are BANNED. The content should pull users in naturally
- **Asymmetric Structure:** Centered Hero layouts BANNED when variance exceeds 4
- **CTA Restraint:** Maximum one primary CTA. No secondary "Learn more" links

### 5. Describe Component Stylings
For each component type, describe shape, color, shadow depth, and interaction behavior:
- **Buttons:** Tactile push feedback on active state. No neon outer glows. No custom mouse cursors
- **Cards:** Use ONLY when elevation communicates hierarchy. Tint shadows to background hue. For high-density layouts, replace cards with border-top dividers or negative space
- **Inputs/Forms:** Label above input, helper text optional, error text below. Standard gap spacing
- **Loading States:** Skeletal loaders matching layout dimensions — no generic circular spinners
- **Empty States:** Composed compositions indicating how to populate data
- **Error States:** Clear, inline error reporting

### 6. Define Layout Principles
- No overlapping elements — every element occupies its own clear spatial zone. No absolute-positioned content stacking
- Centered Hero sections are BANNED when variance exceeds 4 — force Split Screen, Left-Aligned, or Asymmetric Whitespace
- The generic "3 equal cards horizontally" feature row is BANNED — use 2-column Zig-Zag, asymmetric grid, or horizontal scroll
- CSS Grid over Flexbox math — never use `calc()` percentage hacks
- Contain layouts using max-width constraints (e.g., 1400px centered)
- Full-height sections must use `min-h-[100dvh]` — never `h-screen` (iOS Safari catastrophic jump)

### 7. Define Responsive Rules
Every design must work across all viewports:
- **Mobile-First Collapse (< 768px):** All multi-column layouts collapse to single column. No exceptions
- **No Horizontal Scroll:** Horizontal overflow on mobile is a critical failure
- **Typography Scaling:** Headlines scale via `clamp()`. Body text minimum `1rem`/`14px`
- **Touch Targets:** All interactive elements minimum `44px` tap target
- **Image Behavior:** Inline typography images (photos between words) stack below headline on mobile
- **Navigation:** Desktop horizontal nav collapses to clean mobile menu
- **Spacing:** Vertical section gaps reduce proportionally (`clamp(3rem, 8vw, 6rem)`)

### 8. Encode Motion Philosophy
- **Spring Physics default:** `stiffness: 100, damping: 20` — premium, weighty feel. No linear easing
- **Perpetual Micro-Interactions:** Every active component should have an infinite loop state (Pulse, Typewriter, Float, Shimmer)
- **Staggered Orchestration:** Never mount lists instantly — use cascade delays for waterfall reveals
- **Performance:** Animate exclusively via `transform` and `opacity`. Never animate `top`, `left`, `width`, `height`. Grain/noise filters on fixed pseudo-elements only

### 9. List Anti-Patterns (AI Tells)
Encode these as explicit "NEVER DO" rules in the DESIGN.md:
- No emojis anywhere
- No `Inter` font
- No generic serif fonts (`Times New Roman`, `Georgia`, `Garamond`) — distinctive modern serifs only if needed
- No pure black (`#000000`)
- No neon/outer glow shadows
- No oversaturated accents
- No excessive gradient text on large headers
- No custom mouse cursors
- No overlapping elements — clean spatial separation always
- No 3-column equal card layouts
- No generic names ("John Doe", "Acme", "Nexus")
- No fake round numbers (`99.99%`, `50%`)
- No AI copywriting clichés ("Elevate", "Seamless", "Unleash", "Next-Gen")
- No filler UI text: "Scroll to explore", "Swipe down", scroll arrows, bouncing chevrons
- No broken Unsplash links — use `picsum.photos` or SVG avatars
- No centered Hero sections (for high-variance projects)

## Output Format (DESIGN.md Structure)

```markdown
# Design System: [Project Title]

## 1. Visual Theme & Atmosphere
(Evocative description of the mood, density, variance, and motion intensity.
Example: "A restrained, gallery-airy interface with confident asymmetric layouts
and fluid spring-physics motion. The atmosphere is clinical yet warm — like a
well-lit architecture studio.")

## 2. Color Palette & Roles
- **Canvas White** (#F9FAFB) — Primary background surface
- **Pure Surface** (#FFFFFF) — Card and container fill
- **Charcoal Ink** (#18181B) — Primary text, Zinc-950 depth
- **Muted Steel** (#71717A) — Secondary text, descriptions, metadata
- **Whisper Border** (rgba(226,232,240,0.5)) — Card borders, 1px structural lines
- **[Accent Name]** (#XXXXXX) — Single accent for CTAs, active states, focus rings
(Max 1 accent. Saturation < 80%. No purple/neon.)

## 3. Typography Rules
- **Display:** [Font Name] — Track-tight, controlled scale, weight-driven hierarchy
- **Body:** [Font Name] — Relaxed leading, 65ch max-width, neutral secondary color
- **Mono:** [Font Name] — For code, metadata, timestamps, high-density numbers
- **Banned:** Inter, generic system fonts for premium contexts. Serif fonts banned in dashboards.

## 4. Component Stylings
* **Buttons:** Flat, no outer glow. Tactile -1px translate on active. Accent fill for primary, ghost/outline for secondary.
* **Cards:** Generously rounded corners (2.5rem). Diffused whisper shadow. Used only when elevation serves hierarchy. High-density: replace with border-top dividers.
* **Inputs:** Label above, error below. Focus ring in accent color. No floating labels.
* **Loaders:** Skeletal shimmer matching exact layout dimensions. No circular spinners.
* **Empty States:** Composed, illustrated compositions — not just "No data" text.

## 5. Layout Principles
(Grid-first responsive architecture. Asymmetric splits for Hero sections.
Strict single-column collapse below 768px. Max-width containment.
No flexbox percentage math. Generous internal padding.)

## 6. Motion & Interaction
(Spring physics for all interactive elements. Staggered cascade reveals.
Perpetual micro-loops on active dashboard components. Hardware-accelerated
transforms only. Isolated Client Components for CPU-heavy animations.)

## 7. Anti-Patterns (Banned)
(Explicit list of forbidden patterns: no emojis, no Inter, no pure black,
no neon glows, no 3-column equal grids, no AI copywriting clichés,
no generic placeholder names, no broken image links.)
```

## Best Practices
- **Be Descriptive:** "Deep Charcoal Ink (#18181B)" — not just "dark text"
- **Be Functional:** Explain what each element is used for
- **Be Consistent:** Same terminology throughout the document
- **Be Precise:** Include exact hex codes, rem values, pixel values in parentheses
- **Be Opinionated:** This is not a neutral template — it enforces a specific, premium aesthetic

## Tips for Success
1. Start with the atmosphere — understand the vibe before detailing tokens
2. Look for patterns — identify consistent spacing, sizing, and styling
3. Think semantically — name colors by purpose, not just appearance
4. Consider hierarchy — document how visual weight communicates importance
5. Encode the bans — anti-patterns are as important as the rules themselves

## Common Pitfalls to Avoid
- Using technical jargon without translation ("rounded-xl" instead of "generously rounded corners")
- Omitting hex codes or using only descriptive names
- Forgetting functional roles of design elements
- Being too vague in atmosphere descriptions
- Ignoring the anti-pattern list — these are what make the output premium
- Defaulting to generic "safe" designs instead of enforcing the curated aesthetic

---
---

# EXTENDED RULES — Motion, Dynamics & Human-Made Design

> **Precedence:** Everything above this line is the approved base skill and is kept as-is. The Extended Rules below add to it. Where an Extended Rule and a base rule cover the same thing, the **Extended Rule wins**. Each override below names the base rule it refines.

## 10. Font Selection Override (refines §3 and the §3 template)

The fonts named in §3 (`Geist`, `Outfit`, `Cabinet Grotesk`, `Satoshi`, `Fraunces`, `Instrument Serif`, `JetBrains Mono`) have become the new default of AI-generated "premium" UIs. Using them now reads as vibe-coded. Treat them as **fallback references only, never the first choice**.

**Also treat as AI-default (do not pick unless the user names them):** `Inter`, `Roboto`, `Poppins`, `Montserrat`, `Open Sans`, `DM Sans`, `Plus Jakarta Sans`, `Space Grotesk`, `Manrope`, `Sora`, plus the "Instrument Serif italic headline + sans body" editorial combo.

**How to choose instead:**
1. Write the product's voice in three words first (e.g. "precise, civic, calm" or "loud, local, handmade").
2. Pick the display face to match that voice, and state the reason in one sentence inside DESIGN.md. A font with no stated reason is a red flag.
3. Prefer faces with a visible quirk (distinct `a`, `g`, `R`, or numerals) that fits the voice. Starting pools, Google Fonts so Stitch can actually load them:
   - **Grotesk / sans:** `Schibsted Grotesk`, `Bricolage Grotesque`, `Familjen Grotesk`, `Hanken Grotesk`, `Instrument Sans`, `Onest`, `Albert Sans`, `Archivo` (use width axis), `Funnel Display`, `Host Grotesk`
   - **Serif (editorial/marketing only, still banned in dashboards per §3):** `Newsreader`, `Literata`, `Young Serif`, `Gloock`, `Bodoni Moda`, `Spectral`
   - **Mono:** `IBM Plex Mono`, `Martian Mono`, `Commit Mono` (if loadable), `Red Hat Mono`, `Azeret Mono`
4. Do not reuse the same pairing across consecutive projects. Rotate.
5. Fonts from Fontshare or paid foundries (`Satoshi`, `Cabinet Grotesk`, `Gambarino`, `Editorial New`) may silently fall back in Stitch output. If one is used, give a Google Fonts fallback in the same rule.

**Typographic craft details (always encode):**
- Tabular numerals (`font-variant-numeric: tabular-nums`) in tables, prices, counters
- Real punctuation: curly quotes, en dash for ranges (2024–2026), proper ellipsis
- Small uppercase labels get +0.06em to +0.1em tracking; large display text gets negative tracking (−0.02em to −0.04em)
- Use one deliberate typographic contrast per page (width, weight, or case), not all three

## 11. Motion System (extends §8)

Motion must feel **designed, not sprinkled**. Stitch outputs HTML/Tailwind, so every motion rule in DESIGN.md must be expressible as real CSS (keyframes, transitions, `cubic-bezier`/`linear()` easing, scroll-driven animations, View Transitions). Describe it in words **and** give the CSS value.

### 11.1 Motion Tokens (encode exactly)
| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 90ms | Press, toggle, checkbox |
| `--dur-quick` | 160ms | Hover, focus, tooltip |
| `--dur-base` | 260ms | Menus, tabs, accordions |
| `--dur-slow` | 420ms | Sheets, modals, section reveals |
| `--dur-scene` | 700–900ms | One-time hero/page entrance only |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Things entering |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Things leaving (exits are ~30% faster than entrances) |
| `--ease-inout` | `cubic-bezier(0.65, 0, 0.35, 1)` | Things moving between two places |
| `--ease-spring` | `linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077 21.4%, 1.121 24%, 1.149 27%, 1.159, 1.154 33%, 1.051 43.2%, 1.013 49.5%, 0.996 57%, 1.001 72%, 1)` | CSS stand-in for the §8 spring (stiffness 100 / damping 20) |
| `--travel` | 8–16px | Max translate distance for reveals (never 40–100px "fly-ins") |

### 11.2 The Five Motion Layers
Define each layer in DESIGN.md:

1. **Entrance (once per page load):** Hero content reveals in sequence, total under 900ms. Stagger 50–70ms per item; past 6 items, reveal as a group. Technique options: line-by-line headline mask reveal (`clip-path: inset(0 0 100% 0)` → `inset(0)`), opacity + 12px rise, or image scale 1.04 → 1 inside a clipped frame.
2. **Scroll-linked:** Sections reveal as they enter using `animation-timeline: view(); animation-range: entry 0% entry 40%`. Use for meaning (progress bars, timeline steps filling, sticky step-by-step stories), not just fade-in on every block.
3. **Interaction feedback:** Every interactive element has hover, focus-visible, and active states. Press = `scale(0.97)` at `--dur-instant`. Hover changes something **specific to that element**: arrow icon nudges 3px, underline draws from left (`scale-x` 0 → 1, origin left), image zooms 1.03 inside its frame, row background tints. Not "lift + shadow" on everything.
4. **State transitions:** Nothing snaps. Tab indicator slides between tabs. Accordions open via `grid-template-rows: 0fr → 1fr`. Lists reorder/insert with a 160ms fade + 8px shift. Page/detail changes use the View Transitions API (`view-transition-name` on the shared image/title) where supported.
5. **Ambient (strict budget):** Max **one** perpetual animation per screen, slow (≥6s cycle), low amplitude (≤4px or ≤5% opacity change). Examples: live status dot breathing, a marquee of real content (customer names, changelog lines) at a readable speed, a chart line drawing on refresh.

### 11.3 Perpetual Motion Override (refines §8 "Perpetual Micro-Interactions")
"Every active component should have an infinite loop" produces the jittery, everything-wobbles look typical of AI output. Replace with: **perpetual loops only on elements that represent something live** (status, sync, recording, streaming, real-time data), within the §11.2 ambient budget. Shimmer is reserved for actual loading states. Typewriter effects are banned on hero headlines.

### 11.4 Signature Motion Moment
Each page/app gets **one** memorable motion idea, named in DESIGN.md. Rotate between projects. Options:
- Headline lines unmasking with a short delay between lines
- Numbers rolling up to real values when scrolled into view (tabular figures, 600ms)
- Sticky scroll-story: left column pinned, right steps advance and swap the pinned visual
- Shared-element transition from list card to detail page
- Image sequence or product UI scrubbed by scroll position
- Spotlight/highlight that follows the pointer within **one** surface (never a custom cursor — §5 still applies)
- Content-aware hover preview (hovering a list row reveals its thumbnail beside it)

The base skill's Inline Image Typography (§4) counts as one of these options; it is not required on every project.

### 11.5 Mobile & App Motion (Stitch mobile screens)
- Bottom sheets slide up with `--ease-out` at `--dur-slow`; backdrop fades 0 → 40%
- Tapped list items show an immediate pressed tint (no 300ms dead feel)
- Pull-to-refresh, swipe actions and tab switches must be described as gestures with a visual response
- Screen-to-screen: push transitions move 24–32px with fade, not full-width slides on every screen

### 11.6 Accessibility (mandatory)
Every DESIGN.md includes a `prefers-reduced-motion: reduce` rule: entrances become instant opacity changes, scroll-linked and ambient loops are removed, and state changes keep at most a 120ms fade. No content may be hidden until an animation finishes.

### 11.7 Banned Motion (add to §9 list)
- The same "fade-up 0.5s ease" applied to every section
- Bouncing elements, pulsing CTA buttons, wiggling icons
- Floating gradient blobs, rotating conic-gradient borders, aurora backgrounds
- Parallax on text; scroll-jacking; smooth-scroll libraries that change scroll speed
- Fly-ins from far off-screen; motion longer than 900ms outside the entrance scene
- Animations that trigger on every scroll pass (reveal once, then stay)

## 12. Anti-Vibe-Coded Components (extends §5 and §9)

These are the components that make an app look generated. For each, the DESIGN.md must specify the substitute.

| AI-default component | Replace with |
|---|---|
| Pill badge above hero ("New: AI-powered ✨") | Nothing, or one dated plain-text line in mono (e.g. "v2.4 — 3 Oct") |
| Feature cards: icon in rounded square + title + 2 lines | Numbered editorial list with real product crops, or annotated screenshot callouts |
| "Trusted by" grayscale logo strip | One specific quote with full name, role and context — or omit |
| Stats row "10K+ / 99.9% / 24/7" | One real metric with its source and timeframe |
| 3-tier pricing with highlighted "Most Popular" middle | Plan comparison table with honest limits, or a single plan with usage-based detail |
| Testimonial carousel with stars and circular avatars | 1–2 long quotes, set typographically large, no stars |
| Gradient mesh / blob / glow backgrounds | Flat surface; structure through hairline rules, type scale and spacing |
| Glassmorphism cards (`backdrop-blur` + white/10) | Solid surfaces with a defined border or a tint step |
| Bento grid of near-equal tiles | Only when content genuinely differs in size; otherwise a list or table |
| Dashboard: 4 KPI cards each with sparkline and green "+12%" | One headline metric with context, then a dense, sortable table |
| Hero split: headline left, floating phone/3D render right | The product's actual UI, cropped tight to the interesting part |
| Sparkle/wand icon for anything "AI" | A label that says what the feature does |
| "Get started" / "Start for free" CTA | A product-specific verb ("Plan your first route", "Import a spreadsheet") |
| Default shadcn look (zinc, 0.5rem radius, ring) on everything | A deliberate radius system (see §13) and a custom focus style |
| Icon on every list item and nav link | Icons only where they speed up recognition; text labels carry meaning |
| Mega footer with 4 link columns + newsletter box | Compact footer sized to the real number of links |
| Uniform section template repeated down the page | Vary section rhythm: full-bleed, narrow text column, dense table, quote |

## 13. Human Fingerprint Rules (extends §6 and Best Practices)

The design must show evidence of decisions a person made for this specific product.

- **Content first:** Write real, specific copy and data before styling. Lorem ipsum, "Feature One", and placeholder metrics are banned (extends the §9 generic-names rule).
- **One unexpected decision per project**, stated in DESIGN.md: e.g. an oversized section number system, a vertical rail label, a ruled-notebook grid, a single color used only for data, a monospace navigation. It must relate to the product's voice.
- **Radius system:** Choose one family and keep it — sharp (0–2px), soft (6–8px), or round (14–20px). Note the base template's 2.5rem card radius is a starting value; adjust it to the chosen family. Nested elements use inner radius = outer radius − padding.
- **Shadows:** At most two elevation levels. Prefer hairline borders and tint steps over shadows.
- **Grid with intent:** Asymmetry must still align to a declared column grid (e.g. 12 columns, content starting at column 2 or 3). Random offsets look broken, not designed.
- **Imagery art direction:** Pick one treatment for all images (consistent crop ratio, duotone, grain, or framed) and state it. Mixed stock-photo styles are banned.
- **Iconography:** One icon set, one stroke weight, one size scale. If Lucide/Heroicons are used, adjust stroke width (1.25 or 1.75) so they don't look stock.
- **Micro-details:** Visible focus styles designed for the brand, real empty-state copy, thoughtful 404/error text, and data formatted for the locale (dates, currency).

## 14. Extended Output Format

After section 7 of the DESIGN.md template above, append these sections:

```markdown
## 8. Voice & Font Rationale
- **Voice:** [three words]
- **Display:** [Font] — [one-sentence reason tied to the voice] (fallback: [Google Font])
- **Body / Mono:** [Fonts] — [reason]

## 9. Motion System
- **Tokens:** [durations + easings from §11.1]
- **Entrance:** [what reveals, order, total time]
- **Scroll-linked:** [which sections, what meaning the motion conveys]
- **Interaction feedback:** [per component: hover / focus / press]
- **State transitions:** [tabs, accordions, lists, page changes]
- **Ambient (max 1):** [element + cycle length], or "none"
- **Signature moment:** [one named idea from §11.4]
- **Reduced motion:** [fallback behavior]
(Include a short CSS block with the keyframes and tokens so Stitch emits them.)

## 10. Component Substitutions
(List which §12 AI-default components were avoided and what replaced them.)

## 11. Human Fingerprint
- **Unexpected decision:** [what and why]
- **Radius family / elevation levels / grid:** [values]
- **Image treatment / icon set:** [values]
```

## 15. Pre-Flight AI-Tell Audit

Before finalizing DESIGN.md (and again when reviewing a Stitch-generated screen), check for these tells. **Three or more = regenerate the affected section.**

- [ ] A font from the §10 AI-default list without a stated reason
- [ ] Identical fade-up animation on every section
- [ ] More than one perpetual animation on a screen
- [ ] Any component from the left column of §12 without its substitute
- [ ] Gradient, glow, blob or glass background
- [ ] Placeholder copy, round fake numbers, or generic CTA verbs
- [ ] Every section uses the same layout template
- [ ] Mixed radius values or more than two shadow levels
- [ ] Icons on every item regardless of need
- [ ] No reduced-motion rule
- [ ] No named signature motion moment
- [ ] Nothing in the design that could only belong to this product

## 16. Prompting Stitch With This DESIGN.md

- Generate **one screen per prompt**, referencing the DESIGN.md sections by number ("Apply §9 Motion System and §11 Human Fingerprint").
- Explicitly ask Stitch to "include the motion tokens and keyframes in a `<style>` block" — otherwise it tends to output static markup.
- Name the signature moment and the ambient element in the prompt itself; Stitch follows concrete instructions better than general mood.
- After generation, run the §15 audit on the output and send a correction prompt listing only the failed checks.