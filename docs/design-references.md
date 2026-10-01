# Design references: making generated designs look like real products

The design step used to carry one long paragraph of "airlines look like X, banks like Y". That is
the same advice for every run and it is vague. This library replaces it with data the step reads for
the field the requirement is in, and it costs a few hundred tokens per run instead of a research
session.

## How it works

1. `src/design/refs/data.ts` holds 15 industries (airline, bank, fintech, health, retail, food,
   travel, mobility, media, devtools, logistics, telecom, education, government, insurance), each
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
4. The prompt template version is 5, so the cross-run cache does not replay old designs.

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

- Matching is keyword-based. A requirement in a field with no keywords here gets no brief; add
  keywords or an industry.
- The brief shapes the theme (colour, bar, corners, type, density). It does not copy layouts, and
  the model still chooses the screens and sample content.
- Nothing here has been compared against a real run of the model; the first real runs should be
  checked by eye (`factory design refs show` plus the demo screenshots).
