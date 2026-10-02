# Design references: making generated designs look like real products

The design step used to carry one long paragraph of "airlines look like X, banks like Y". That is
the same advice for every run and it is vague. This library replaces it with data the step reads for
the field the requirement is in, and it costs a few hundred tokens per run instead of a research
session.

## References the user attaches (approved 2026-10-02, built; live runs pending)

This library is the fallback, not the first source. A user can attach design references to any run
(a design-only run, estimate, brownfield, and greenfield once it exists), from the terminal (`--ref`) or the factory UI:
any image (png, jpeg, webp, gif, avif, svg, bmp), a website URL, a Figma link or export, a PDF or a
brand guide. Each becomes `R-1`, `R-2`, ... with an optional role:

| Attached | Look (colours, type, corners) | Layout |
|---|---|---|
| Nothing | **This library, exactly as below** (no extra step, no extra cost) | From the requirements |
| `layout` references only | This library | From the references for those screens |
| `inspire` references | Within the references' colour family; this library fills the gaps | References and requirements |
| `match` references (default for a Figma file or brand guide) | The references' values exactly | References and requirements |

- Exact values come from a site's CSS or the Figma file; colours measured from a picture are marked approximate. A vision step (`design-refs`, read-only) reads the pictures; the model picks colours from what code measured and never types one.
- With references, `theme.basis` cites R-ids instead of the briefed brands. The reference checks in step 5 below measure against the reference palette for `inspire`; `match` has its own checks (`design-ref-colour`, `design-ref-font`). The record of recent looks is skipped for `match` (a client's brand may repeat) and kept for `inspire`.
- The requirements beat a reference; a departure is written in `departure`. Every reference is used or set aside with a reason (`design-ref-unused`).
- A reference that cannot be read (a login wall, a private Figma file, an unknown format) stops the run at intake with a plain message. It never falls back to this library without saying so.

Full plan and build order: `docs/estimates-design.md`, "Design references". Done so far: images reach the model (step 1); the design steps are one piece any mode plugs in (step 2); `--ref` reads images, sites and Word documents into `R-n` at intake (step 3; the design step does not use them yet); a design can be seen on its own with `factory design start`, shown with `factory design show|open`, references checked for free with `factory design check-refs`, and an approved design sized or built with `--from-design` (step 3b); Figma links (with `FIGMA_TOKEN`), Figma JSON exports and PDFs are read too (step 4); a read-only `design-refs` step describes each reference from its pictures and measured values, before the design (step 5). The design step uses that reading: the references replace the field's library for the look, each by its role, and code checks every reference is used or set aside and that match colours and type are kept (step 6). The drawn demo is read in a browser, and a screen that cites a layout reference must show that reference's navigation and regions (step 7). The Factory UI takes references on New run in every mode and shows them, with what they shaped, on the Design tab and the design card (step 8). A direct brownfield build that touches UI draws and approves its design before plan; when the app has its own look and a reference is `match`, the questions card asks whether to keep the app's look or restyle it (step 9).

Once approved, the design is what the build turns into code: the stub commit writes it in the chosen UI target (the shadcn kit, the approved look as a theme, a page per screen), and the agents write behaviour only (`docs/estimates-design.md`, "Kit and scaffold (as built)").

A designer's changes in Figma after an export come back the same way: the file's link is attached as a `match` reference, and the change goes through the approval card as a new design version (`docs/estimates-design.md`, "Design handoff").

## How it works (no references, or for what they leave open)

1. `src/design/refs/data.ts` holds 24 industries (airline, bank, fintech, health, pharmacy, retail,
   grocery, food, travel, mobility, media, devtools, logistics, telecom, education, government,
   insurance, real estate, fitness, events, HR, manufacturing, automotive, non-profit), each
   with 4 to 6 well-known brands: brand colour, optional accent, light or dark, filled or plain app
   bar, corner sharpness, and one phrase on what makes the product recognisable. Each industry also
   has a short "what they share, what differs" note and the theme fields the field usually uses.
2. `matchIndustries` / `pickIndustries` (`refs/index.ts`) score the requirement text against each
   industry's keywords (whole words). One stray word is not a match; a second industry is added only
   when it scores at least half as well (a hotel app that takes payments).
3. `referenceBrief` renders only the matched industry (about 400 tokens) and the design step
   (`src/stages/design.ts`) adds it as a "design references" section. The rules tell the model to
   stay in the family, borrow what the brands share, and not reuse any one brand's exact colour,
   name or logo. No match, no section, and the rules fall back to a general line.
4. The prompt template version is 19, so the cross-run cache does not replay old designs.
5. **Proof, checked in code** (`refs/fit.ts`). The design's `theme.basis` must cite at least two of the briefed brands and what was taken from each. The references are guardrails, not a template: the brand colour may sit outside the field's colours (more than 40 degrees of hue from every reference colour) only when the theme says in `departure` what in the product reading makes this product differ (`design-off-reference` otherwise). A neon brand in a field people trust with money, health or duties needs a departure too (`design-neon`). The brand must not be the same shade as one brand (`design-copied`). A failure sends the model back with the reason. For a field with no references, `basis` must name two or three well-known real products. None of this is shown to the lead; they see only the final design.
6. **Silent live read, every new design.** Before the model call, `ensureMeasured` (`refs/measure.ts`) opens up to four of the matched brands, unread ones first and then those read longest ago (a reading older than 7 days counts as stale), within a 45 second cap. Each good reading is saved as it arrives, so a slow site never costs the readings already taken, and the read stops at the cap. A request whose field is not in the library reads nothing. It is best effort: any failure keeps the reported colours. Set `FACTORY_DESIGN_LIVE_REFS=0` to turn it off (tests turn it off themselves). It runs only before a full draw or a fix to the look; a fix to a page's layout or sample content skips it. The browser is found on its own: `FACTORY_CHROMIUM` if set, else Playwright's browsers (Linux, macOS, Windows), else an installed Chrome, Chromium, Edge or Brave.

## Fields nobody listed

The list of fields is not the limit. Every industry belongs to one of nine **look families**
(trust and money, care, browse and buy, travel and experience, operations, media, learning, public
service, professional tool), each a few lines on how products of that kind are coloured and shaped.

- A requirement that matches a listed field gets that field's brands plus its family.
- A requirement that matches nothing (a museum guide, a vet clinic, a legal case tracker) gets the
  family list instead, about 300 tokens, and is told to decide what kind of product it is, blend two
  families when mixed (a hospital portal is care plus professional tool), think of two or three
  well-known products of that kind, and pick its own colour in that family.
- You can add fields without touching code: put a JSON file (one industry or an array) in
  `~/.factory/design-refs/industries/`. It has the same shape as an entry in `data.ts`, including
  an `archetype`. A file with the same id replaces the built-in. Invalid files are skipped and shown
  by `factory design refs list`.

## Why projects in one family do not come out the same

A family or field gives a starting point, not the answer. These keep two projects apart:

- **The product is read first.** Before any look is chosen the model returns `theme.reading`
  (users, context, device, tone, the moment that matters most, traits) from the requirements alone,
  and every theme choice must follow from it (`design-no-reading`, `design-reading-mismatch`).
- **Recent looks are remembered.** Approved looks are stored in `~/.factory/design-looks.json`
  (`src/design/looks.ts`), each with the field it matched (`health`, `hotel+payments`). A new
  design is shown the six latest other projects' looks, plus up to three older ones in its own
  field, and must differ from each by at least 4 points (`design-look-repeat`).
- **The product's own signals.** The brief ends with the words in the requirements that say who
  uses the product and how (`requirementCues`): children, older users, on the move, at a desk all
  day, premium, urgent, worried users, learners, money, social, business buyers, night use, patchy
  networks, playful. At most six, each with what it usually means for the look. A clinic's patient
  app and its back office share the field's brands but get different signals.
- The brands shown start at a different place for each requirement (seeded by the requirement
  text, so one requirement always gets the same brief). The first is marked `(lead)`.
- The brief tells the model that field defaults are where products start: it must change at least
  two of bar, corners, type, density, surface, neutrals or mode for this product's audience, and
  say why in `mood`.
- It must pick its own brand colour and may not reuse any listed brand's value, name or logo.

The look record makes a repeat of a recent project fail in code. It counts the type as the body
and heading pair (six body fonts, seven heading faces) and the logo mark (glyph, monogram, emblem
or wordmark), so those choices also keep projects apart. Within a field, the brief now differs by
its lead brand, the requirement signals and the earlier projects in that field. If two runs still
look alike, add an industry file with more brands or sharper notes for that field.

## Reported versus measured

The colours in `data.ts` are reported: gathered from brand pages and aggregator sites and rounded.
Until measured, they were not read from the live sites, and sources
disagree (Lufthansa's navy appears as three different values). They are enough to show the family;
do not treat them as brand-accurate.

The design step measures a few brands on its own each time (see step 6). To measure everything up front, run where the sites are reachable:

```
factory design refs measure                      # every brand
factory design refs measure --industry airline   # one field
```

Each brand's site is opened on a 390 px phone viewport and the page is read for the `theme-color`
meta, the header background, the most prominent filled button (largest non-grey), the body
background, the body font and the button radius. Readings that found a colour are stored in
`~/.factory/design-refs/measured.json` and win over the reported value; the brief marks them
`[measured]`. A site that blocks the browser or times out is shown as an error row and keeps its
reported value. A reading is kept only when it is plausible: its colour is within 60 degrees of hue
of the reported brand or accent, or at least two of the page's own signals (theme colour, button,
header) agree within 20 degrees, which lets a real rebrand through and drops a cookie banner's blue.
A reading that fails is shown as an error row and the reported value stays. Run it again whenever
you want a refresh; it overwrites only the brands it reached.

Other commands:

```
factory design refs list                 # industries, brands, measured or reported
factory design refs show airline         # the brief the design step would get
factory design refs show "<requirement text>"
```

## Controls a design can use (design template 20)

The references set the look; the controls are the same in every field. Besides the blocks, the page frames, overlays and states, a page can use these:

- **Buttons:** a plain label, or `{ label, variant, icon, iconOnly, state, hint, menu }`.
  - Variants: primary, secondary, ghost, danger and link.
  - States: disabled and loading.
  - `hint` is the button's tooltip, and an icon-only button gets its label as one.
  - `menu` makes it a split button.
- **Form fields:**
  - text, email, password (show/hide), textarea, number, currency, phone, date, date range, time, select, multiselect (chips), combobox (type to filter), radio, checkbox, toggle, slider, one-time code, card and consent;
  - each field can be `required`, have `help` and a `hint` tooltip, be `disabled` or `readOnly`, and carry its own `error` for the validation state.
- **Blocks:**
  - `alert`: an inline banner in four tones;
  - `toolbar`: search, up to three dropdowns and buttons, set on the table it filters;
  - linear `progress`;
  - tables with working `pages`.
- **Small parts:**
  - a page `badge` beside the title;
  - badge values in detail rows;
  - `people` (avatar groups) on cards, list rows and detail;
  - a `popover` overlay.
- **The Components page.** The demo draws every control the pages use, in each state, in the chosen look. A reference's look can be checked there at a glance.

## Extending

Add a brand or an industry in `data.ts` (the schema is checked at import and by
`refs.test.ts`). Keep the brief short: at most six brands, a note under 420 characters. Measured
readings need no code change.

## Limits

- Matching is keyword-based, so an unlisted field falls back to the look families (coarser, but
  never empty). Add an industry file when you see the same field again.
- The brief shapes the theme (colour, bar, corners, type, density). It does not copy layouts, and
  the model still chooses the screens and sample content.
- Nothing here has been compared against a real run of the model; the first real runs should be
  checked by eye (`factory design refs show` plus the demo screenshots). The design step measures the drawn demo in a browser and
  sends text that overflows, is cut off or overlaps back to the model for one fix. Anything left
  is listed on the design card, measured while the screenshots are taken.
