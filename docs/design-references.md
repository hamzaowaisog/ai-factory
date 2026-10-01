# Design references: making generated designs look like real products

The design step used to carry one long paragraph of "airlines look like X, banks like Y". That is
the same advice for every run and it is vague. This library replaces it with data the step reads for
the field the requirement is in, and it costs a few hundred tokens per run instead of a research
session.

## How it works

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
4. The prompt template version is 13, so the cross-run cache does not replay old designs.
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
  (`src/design/looks.ts`). A new design is shown the six latest other projects' looks and must
  differ from each by at least 4 points (`design-look-repeat`).
- The brands shown start at a different place for each requirement (seeded by the requirement
  text, so one requirement always gets the same brief). The first is marked `(lead)`.
- The brief tells the model that field defaults are where products start: it must change at least
  two of bar, corners, type, density, surface, neutrals or mode for this product's audience, and
  say why in `mood`.
- It must pick its own brand colour and may not reuse any listed brand's value, name or logo.

The look record makes a repeat of a recent project fail in code. The brief text itself still
varies little within a field, and the type choice is still four font stacks with no heading and
body pairing and one family of logo marks. If two runs still look alike, add an industry file with
more brands or sharper notes for that field.

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
  checked by eye (`factory design refs show` plus the demo screenshots). The design card also
  lists text in the demo that overflows, is cut off or overlaps, measured while the screenshots
  are taken.
