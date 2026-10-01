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
4. The prompt template version is 6, so the cross-run cache does not replay old designs.

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

## Reported versus measured

The colours in `data.ts` are reported: gathered from brand pages and aggregator sites and rounded.
They were not measured from the live sites (this environment cannot reach them), and sources
disagree (Lufthansa's navy appears as three different values). They are enough to show the family;
do not treat them as brand-accurate.

To replace them with measurements, run where the sites are reachable:

```
factory design refs measure                      # every brand
factory design refs measure --industry airline   # one field
```

Each brand's site is opened on a 390 px phone viewport and the page is read for the `theme-color`
meta, the header background, the most prominent filled button (largest non-grey), the body
background, the body font and the button radius. Readings that found a colour are stored in
`~/.factory/design-refs/measured.json` and win over the reported value; the brief marks them
`[measured]`. A site that blocks the browser or times out is shown as an error row and keeps its
reported value. Run it again whenever you want a refresh; it overwrites only the brands it reached.
Sites often show cookie banners or redesign, so read the output before trusting a reading.

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
  checked by eye (`factory design refs show` plus the demo screenshots).
