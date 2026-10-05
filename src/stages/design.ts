// Estimate mode's design step (docs/estimates-design.md, "Design baseline"). For a request with UI it
// proposes the screen inventory the estimate stands on: a flow, every screen with its route and the
// requirements it serves, and a reason for each requirement that needs no screen. Code checks the links
// both ways. It is an inventory of screens with sample content, not a finished design: a person approves it at E1b, and it
// becomes the count of screens, flows and reused components for the UI work.
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { IntentBody, Spec } from "../contracts/index.js";
import type { Failure } from "../contracts/common.js";
import type { ResolvedSection } from "../context/pack.js";
import { backToSettle } from "./settle.js";
import { inPool } from "../util/pool.js";
import type { RunState } from "../ledger/state.js";
import { hasExistingLook, type DesignInventory } from "../design/inventory.js";
import type { Ledger } from "../ledger/ledger.js";
import { restyleChosen, type ClarifyResult } from "./clarify.js";
import { btnLabels, DesignApp, DesignLocale, DesignTheme, MockBlockFull, ScreenMock, ScreenMockFull, Switcher } from "../contracts/artifacts.js";
import { failure } from "../gates/engine.js";
import { header, outputOf, readOutput, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { lightUi } from "./lane.js";
import { lookFromRefs, lookRefs, matchFamilies, refBrief as clientRefBrief, refFit, refLayoutFixes, refLayoutGaps, refNotes, REF_RULES, type RefLayoutGap, type RefUse } from "../design/ref-checks.js";
import type { DesignRefsArt } from "./design-refs.js";
import { ESTIMATE_SOURCES, intentOf, inventoryNamed, repoInventory, sourcesReady, specOf, type DesignSources } from "./design-inputs.js";
import { briefFor, fieldOf, pickIndustries } from "../design/refs/index.js";
import { fitRefs, themeFit, type FitRefs } from "../design/refs/fit.js";
import { ensureMeasured } from "../design/refs/measure.js";
import { lookBrief, lookKey, lookRepeats, readingFit, recentLooks, type Look } from "../design/looks.js";
import { S, think, UNTRUSTED_IMAGE_NOTE, UNTRUSTED_NOTE } from "./think.js";
import { carriedLines, carries } from "./gate-questions.js";
import { buildDemo, demoStates, themeValues } from "../design/demo.js";
import { contrastIssues } from "../design/palette.js";
import { localeFit } from "../design/locale.js";
import { checkDemoLayout, LAYOUT_FAULT, readDemoLayout, type LayoutIssue, type RenderedLayout } from "../design/screenshots.js";
import { decideRework, designIndex, roundOf, screenName, Triage, TRIAGE_RULES, type ReworkPlan, type ReworkRound } from "./design-rework.js";

type Intent = z.infer<typeof IntentBody>;

export const DesignOut = z.object({
  flow: z.string().min(1),
  screens: z.array(z.object({
    id: z.string(), route: z.string().min(1), file: z.string().min(1), reqs: z.array(z.string()),
    states: z.array(z.string()).default([]),
    /** new screen, a tweak of an existing one, a design-system change, or reuse of existing components */
    size: z.enum(["new", "tweak", "design-system", "reuse"]).default("new"),
    /** attached design frames (F-1, ...) that show this screen or one of its states */
    frames: z.array(z.string()).default([]),
    /** believable sample content for the clickable demo; absent, the demo draws a plain wireframe */
    mock: ScreenMock.optional(),
    /** the same page with fine-grained data: shown as the demo's "Full data" state */
    mockFull: ScreenMockFull.optional(),
    /** the app it belongs to (an id from "apps"), when the product has more than one */
    app: z.string().optional(),
    /** the navigation group it is listed under in a sidebar or drawer (Money, Cards, Settings) */
    group: z.string().max(24).optional(),
    /** the client's design references (R-1, ...) that shaped this screen */
    refs: z.array(z.string()).optional(),
  })).min(1),
  /** the product's apps when it has more than one: a customer phone app and an admin portal each get their own device and frame */
  apps: z.array(DesignApp).max(4).optional(),
  /** who or what a one-app product is acting for, switched from its frame (an app of several carries its own) */
  switcher: Switcher.optional(),
  /** the look of the product: chosen from what the requirements say it is and who uses it */
  theme: DesignTheme.optional(),
  /** the languages the product is offered in and its local formats, when the requirements name them */
  locale: DesignLocale.optional(),
  /** requirements that need no screen (an API rule, a job) and why */
  noScreen: z.array(z.object({ req: z.string(), reason: z.string().min(1) })).default([]),
  /** with design references: how each was used, or why it was set aside */
  refUse: z.array(z.object({ id: z.string(), use: z.enum(["used", "set-aside"]), how: z.string().max(200) })).optional(),
});

const RULES = `You are a principal UI/UX engineer with fifteen years shipping consumer and enterprise products, drawing the screen inventory of a UI request for an estimate. The approved inventory is what the estimate counts. Hold the work to the standard of a design review at a top product studio: clear visual hierarchy, one focal point per screen, consistent spacing rhythm, readable contrast, real content, every state considered. If it would not survive that review, redo it before answering.
- List every screen a user sees: id S-1, S-2, ..., its route, a proposed file path, the requirement ids it serves in "reqs", the extra states it has besides its normal page (empty, loading, error, success, validation; the normal page is always shown) and its size:
  new (a screen that does not exist), tweak (a change to an existing screen), design-system (a new shared component or theme change), reuse (built only from existing components).
- Every requirement that has anything a user sees or does goes on at least one screen. A requirement with no screen at all (an API rule, a scheduled job) goes in "noScreen" with the reason. Nothing may be left out.
- "flow": two or three sentences on how a user moves between the screens.
- Use only requirement ids that exist. Do not invent screens the requirements do not need.
- ART DIRECTION. Start with the PRODUCT READING, before any colour or frame: from the requirements alone, work out who uses the product, where and when (at a desk all day, on a phone in a queue, once a year at tax time), on what device, the tone it must take with them, the one moment that matters most (the hero moment: a balance seen, a gate found, a dose confirmed) and two to four traits that make this product unlike its competitors. Return it as theme "reading": users, context, device ("web", "phone" or "both"), tone, hero, traits. Every later choice (frame, type, corners, surfaces, colour, charts, pictures) must follow from this reading, so two products in the same field still look like themselves. Code rejects a theme with no reading, and a phone product drawn as a sidebar tool.
  Then it is proof-driven design, not invention: compare the product with the real market: the "design-references" section lists the top products of this field (or, when the field is not listed, the nearest kind of product) with their brand colours, bar, corners and traits. Study what they share, and build the look from that.
  Return "theme" with:
  basis: two to four of those real products and what you took from each ("Delta: navy headings, red only on the primary action", "Emirates: filled brand bar, large photography"). The references are guardrails, not a template: take what the field has learned (what its users trust, what they expect to find where), never a competitor's whole look. Code rejects a theme that cites fewer than two briefed products, one that is a competitor's exact shade, and one whose brand colour is far (over 40 degrees of hue) from every reference colour of the field unless "departure" says, in one sentence, what in the product reading makes this product leave the field's colours (a bank for teenagers, a clinic app that must feel like a spa). A neon brand in a field people trust with money, health or duties also needs a departure.
  If a "recent-looks" section is given, those are the looks of the factory's latest other projects: this product must not look like any of them. Let the reading choose where it differs.
  How real products are coloured: a mostly neutral page (white or near-white, or a deliberate dark), near-black text, ONE brand colour used for the app bar, the primary action and selection, and status colours only where they carry meaning (green done, red wrong, amber attention). Colour is information, not decoration.
  The result must look current and expensive, the kind of product shipped this year: confident type scale, generous spacing, depth from soft layered surfaces, and motion everywhere it helps (entrances, hover lift, counting numbers, drawing charts, skeleton shimmer, state transitions). It must not look machine-made. Avoid purple-to-blue gradients with no source in the field, neon glows on a business tool, glass panels everywhere, several accent colours, rainbow icons, one huge radius on everything, and centred "three cards" layouts.
  mood: two or three words for the feeling (for example "calm clinical", "precise financial", "warm retail"). Invent the one that fits.
  mode: "light" for most products, "dark" only when the audience works in it for hours (developer, trading, media, creative tools), "auto" for both, following the viewer's setting (whenever the requirements ask for a dark mode, a theme switch or the system's appearance; the demo then has a light/dark switch and every page is shown in both).
  brand: the one brand colour (#rrggbb), in the family of the references, as a competitor in the field would choose it. accent: optional second colour for a sparing highlight, only when the field has one (for example a gold on navy, or the red beside navy).
  neutral: "cool" (technical, finance, health), "warm" (food, hospitality, craft, education) or "pure" (editorial, minimal).
  chrome: "brand" fills the app bar with the brand colour (airlines, retail, telecom, many consumer apps); "plain" keeps it white or dark (SaaS, back-office, finance, health).
  TYPE AND MARK are the product's voice: choose them from the reading, never by default.
  font (the body): "sans" (neutral product UI), "humanist" (friendly: health, education, public services), "serif" (sans body with serif headings), "rounded" (playful consumer), "grotesk" (plain Swiss: design tools, transport, editorial UI) or "book" (a serif to read in: news, long reading, learning).
  heading (the type of titles, figures and the name, paired with the body): "match" (the body's own), "serif" (editorial, legal, heritage, hospitality), "display" (a high-contrast luxury serif: fashion, jewellery, premium travel), "geometric" (modern consumer, mobility, fitness), "condensed" (sport, news, transport boards, dense dashboards), "slab" (sturdy and practical: logistics, tools, outdoor, food) or "mono" (developer, data, technical). Pair for contrast: a serif or display heading over a sans body, a geometric heading over a humanist body; a plain tool may match.
  mark (the logo): "glyph" (an abstract shape on a tile), "monogram" (the initial on a tile: banks, firms, institutions), "wordmark" (the name alone in the heading type: editorial, fashion, consumer brands known by name) or "emblem" (a symbol of what the product does on a tile: a plane, a leaf, a heart).
  radius: "sharp" (enterprise, data-dense, government), "soft" (most products) or "round" (friendly consumer).
  density: "compact" for tools used all day, "comfortable" otherwise.
  surface: "soft" (layered cards with a light shadow: the modern default), "flat" (hairline borders, no shadow; dense back-office tools) or "glass" (translucent; media, creative or premium consumer products).
  motion: "lively" (the default) or "calm" (only for serious, high-stakes tools). The page animates either way; calm only quiets it.
  fx: "modern" (the default: cards lift on hover, content rises in, charts draw, numbers count up), "futuristic" (all of that plus a fine dot grid under the page, lit card edges, tinted figure icons and live status dots; for products whose users expect it, such as fintech, media, AI and developer tools) or "quiet" (fades only, no lift; government, legal, clinical back-office). None of them uses glows, blobs or gradient text.
  The structure comes from the references too, so two products never share a frame by default:
  shell: "sidebar" (tools used all day: back-office, analytics, admin, CRM, trading), "topbar" (sites and consumer products: travel, retail, banking web, marketplaces; content sits in a contained column), "drawer" (a menu button opening a side drawer: content-first sites and phone apps with many sections), "tabs" (a bottom tab bar: phone apps with three to five main sections), "minimal" (a single task done start to finish: checkout, booking, onboarding, a status page; logo only, one narrow column) or "auto" (chosen from the pages). A phone product uses tabs, drawer or minimal; a web product never uses tabs.
  hero: "band" puts the page title on a brand-coloured band that the first block overlaps (a bank's balance, an airline's search, a booking summary), as many consumer products do; "none" keeps the title plain on the page (most tools).
  charts: "soft" (muted bars with the peak in brand, a light area under lines: the default), "bold" (brand bars and a strong area; consumer and marketing dashboards) or "mono" (grey bars, ink lines, no fill; finance, research, editorial).
  imagery: the light of drawn pictures on cards, matched to the brand's mood: "day" (fresh, clear), "golden" (warm, hospitality, food), "dusk" (premium, nightlife), "mixed" (varied listings), or "icons" (icon tiles where a photo would be fake, such as B2B items, documents or services).
- NAVIGATION. In a sidebar or drawer app with six or more sections, give each screen a "group" (two to four groups, such as Money, Cards, Settings) so the menu reads in sections; otherwise leave groups out. When the user acts for one of several accounts, workspaces, companies, branches or profiles (a business with two companies, a SaaS user in several workspaces, a family's profiles), add a "switcher": its kind, the current one, an optional meta line (a plan, a role) and one to four others. It sits in the frame (the sidebar's top, else the top bar).
- APPS. When the requirements describe more than one app (a customer phone app and an admin portal, a driver app and a dispatch console), return "apps": each with an id (lowercase, such as "customer" or "admin"), a name, its device ("web" or "phone"), its own shell (as above, chosen for that app's users and device), who uses it and its own "switcher" when it has one; and give every screen the "app" it belongs to. The apps share the one theme: they are one product. A product with one app leaves "apps" out.
- LANGUAGES. When the requirements name a language other than English, right to left, or a product in two languages (Urdu and English, Arabic and English), return "locale": "languages" the product is offered in, the one it opens in first (at most two; with two, one is "en"); "region" (the market, ISO code such as PK, AE, SA); "currency" (ISO code, such as PKR); "dates" (the market's order: "dmy", "mdy" or "ymd"); "digits" ("native" when the market writes numbers in its script's own digits, as in Saudi Arabia, else "latin"); "strings" the frame's words that no page carries (navigation group names, app names, the switcher's names) in the other language. Otherwise leave "locale" out.
  The demo shows each page in either language, mirrored for a right-to-left one (Arabic, Urdu, Persian, Hebrew), with the market's first weekday and weekend; the build gets the same.
- MOCK CONTENT. For every screen also give "mock": what the page shows, as a picture to react to, not a spec.
  Take every noun from the requirements' own domain: its entities, roles, statuses, units, currencies, places, names and formats. Make the sample data believable and varied (different lengths, several statuses, plausible dates and amounts that agree with each other). Never "Lorem ipsum", "Item 1", "Column A", "Test User" or "Sample".
  "title" and "subtitle" of the page; "crumbs" when the page sits under others (the trail above it, outermost first: "Accounts", "Savings ··4821"; a phone shows a back button instead); "tabs" when one record or area is seen several ways on the same page (Overview, Activity, Documents; the first is the one drawn), never as a stand-in for pages of their own; "badge" the record's status beside the title on a page about one record (Active, Overdue, Draft); "blocks" in page order (2 to 5), each one of: stats (label, value, delta), filters (search placeholder, chips that narrow what is shown, and "segments" that switch how it is shown, such as List/Map or Day/Week/Month), table (columns, 4 to 6 rows of cells, statusColumn = index of the status column; "sortBy" (a column index) and "sortDir" when people sort it; "selectable" and "bulk" (what can be done to the ticked rows at once: "Export", "Mark paid") when people act on several rows together; "pages" (and "page", the one shown) when the rows are one page of many), form (fields with label, kind, placeholder or value, options; the submit label; kinds: text, select, date, textarea, toggle, radio (one of 2 to 5 options shown at once), checkbox (several options; value lists the ticked ones, comma-separated), number, currency (value with its code: "PKR 25,000"), otp (a one-time code), phone (value with its country code: "+92 300 1234567"), search (a select typed into, for long lists), slider (options are the two ends: "0 km", "50 km"), card (card number, expiry and code; never a real number), password (with show and hide), email, time, daterange (value "12 Mar 2026 - 18 Mar 2026"), multiselect (several of a long list, shown as chips; value lists them comma-separated), combobox (type to filter a long list, one picked), consent (one "I agree" box, the label is the sentence: terms, marketing); pick the kind the requirement's input is, not text for everything; per field also "required" (marked, and flagged when empty in the validation state), "help" (a line under it: a format, a limit), "error" (its own message for the validation state: "Enter a valid IBAN"), "disabled" or "readOnly" (shown but not editable: a verified email, a locked amount) and "hint" (a tooltip beside the label), each only where the requirements need it), chart (kind, title, labelled points, and "ranges" such as 7D/30D/1Y when the requirements let the period be changed; kinds: bar (amounts per period, 5 to 8 points), line (a level over time, 5 to 8 points), stacked (bars split into 2 to 4 "series", each point's "parts" in series order: revenue by channel per month), donut (shares of a whole, 2 to 6 points: spend by category), progress (1 to 4 goals, each value a percent: course completion, savings goals), gauge (one reading against its scale: one point, "max" the top of the scale, "unit": a credit score, a fuel level); pick the kind the requirement's numbers are), cards (title, meta, badge, "people" (who is on it: a team, attendees, shown as overlapping avatars); visual true for things people choose by picture, like products, places, listings), carousel (slides seen one at a time, each title, meta, badge, cta: style "promo" for offers, announcements or onboarding on the brand colour, "media" for a row of things chosen by picture; only where the requirements show a few featured things in turn, never as a stand-in for a list), list (title, meta, optional badge and people), accordion (sections opened one at a time, each title and body: questions and answers, a policy's sections, settings groups; never to hide the page's main content), steps (a progress or checkout path, current index), timeline (time, title, status done/now/next: tracking, history, itinerary), detail (a record's labelled facts, "badge" true on a row whose value is a status, "people" who it belongs to or is shared with; style "pass" for a ticket, booking or boarding pass, with a lead value like the route or amount), calendar (a month to pick a day in: "month" such as "March 2027", "startsOn" the weekday of the 1st (0 Monday to 6 Sunday) and "days" as that real month has them, "marks" on days with a tone and an optional short label (a booking, a deadline), "off" for closed days, "picked" day, and "times" with "taken" and the picked "time" when a slot is booked on the day: appointments, classes, rentals), map (places on a map: "area", "pins" each label, meta, tone, and "route" true when they are stops in order: stores near you, a delivery's stops, properties), gallery (pictures of one thing: layout "hero" for a large one with thumbnails (a listing, a product), "grid" for a wall of equal tiles (a portfolio, a room's photos); each item a caption), upload (a drop zone: label, hint with types and size limit, and the files already added, each name, size and status done, uploading with progress, or failed), chat (a conversation: "with" whom, meta such as "Online" or their role, "messages" from me or them with times, up to 4 "quick" replies: support, a driver, a tutor), kanban (work moving through stages: 2 to 5 "columns" each with a title and cards (title, meta such as "Sara Khan · Due Fri", badge)), plans (pricing: 2 to 4 items, each name, price, "per" (the unit, such as "/ month"), blurb, features, cta, at most one "featured" with a badge; with two "periods" ("Monthly", "Yearly") every item has "alt", its price per the same unit billed in the second period, and "note" says the saving), reviews (a rating: score out of 5, count ("1,284 reviews"), "bars" the percent at 5 down to 1 stars, and reviews each name, rating, text, time, tag), notifications (what happened for the user: items each title, meta, time, tone, unread, and "group" such as Today or Earlier), results (search results with filters beside them: query, count ("214 stays"), sort options, "facets" each a title, kind check (2 to 6 options, the ticked ones in "picked") or range (two ends in options, "picked" the value), and items each title, meta, badge, price; "visual" when chosen by picture), compare (2 to 4 things side by side: items each name, meta, at most one featured; "rows" each a label and one value per item, "Yes"/"No" where the answer is yes or no; "cta" the button under each), receipt (a receipt or invoice as a document: title with its number, status, from, to, up to 4 "facts" (date, method), "lines" each item, qty, amount, and "totals" in order with the amount due last (Subtotal, a discount as negative, tax, Total), so the numbers add up; optional note), actions (buttons), alert (a message inside the page, not a toast: tone info, ok, warn or bad, optional title, text, optional "action" button: a KYC reminder, a failed sync, a plan limit reached), toolbar (the controls over a list or report that are not a form: optional search, up to 3 "selects" each a label ("Sort by", "Status"), options and the chosen value, and up to 3 buttons such as "Columns" or a split "Export"; put it right before the table, cards or list it acts on), progress (bars for how far things have got: optional title, 1 to 4 items each label, value (a percent) and meta ("3 of 5 steps", "8.2 of 10 GB"): profile completeness, storage used, a course), text (body).
  A button anywhere ("buttons" of actions and toolbar, "bulk", an overlay's "actions") is a plain label, or an object when it needs more: "label", "variant" (primary for the one main action, secondary, ghost for quiet ones, danger for a step that deletes, cancels or takes something away, link), "icon" (a word: download, plus, filter, share, edit, trash), "iconOnly" true for a small icon button (the label becomes its name and tooltip), "state" disabled (not possible yet: Submit before the form is complete) or loading, "hint" (a tooltip) and "menu" (a split button: the arrow beside it offers these choices, such as "Export" with "CSV", "Excel", "PDF"). A plain label list makes the first one primary. A menu choice can be an overlay's trigger or a toast's "after", like any button.
  When a requirement names one of those (booking a slot, a map of places, photos, attaching documents, messaging, a board of stages, pricing tiers, ratings, notifications, filtered search, comparing options, a receipt or invoice), draw it with that block, never a list or table standing in for it.
  "links" (up to 8) for where the page leads, so the demo can be clicked through as the product would be: "from" is the exact label of a button, the first cell of a table row, or the title of a card, list item or slide on this page; "to" is the id of the screen it opens (a row to its record, a card to its detail, "Pay bills" to the bills screen). Link every path the requirements' journeys take.
  "overlays" (up to 3) when an action opens a layer over the page instead of a page of its own: kind "modal" (a short form or record, like Add payee), "drawer" (a side panel with a record's details or filters, on wide screens), "sheet" (a bottom sheet, the phone's way to pick, confirm or enter a little), "confirm" (a yes-or-no for a risky or final step: freeze, delete, submit, pay; text says what happens) "menu" (a short list of row or page actions in "items") or "popover" (a small panel beside its button, not a dialog: a quick filter, a share link, a date range). Its "trigger" is the exact label of a button on the page (an actions button or a form's submit), or "More" for the menu of a table row; it has a "title", optional "text", up to 2 small "blocks" (a form, the record's detail, a list) and up to 2 "actions", the main one first. Use one where the requirements describe that interaction; a page of its own stays a screen. Each is shown open in the demo.
  "toasts" (up to 3) for the short confirmations that slide in after an action and go by themselves ("Payment sent", "Card frozen", "Saved to trips"): "after" is the exact label of the button, menu item or overlay action that shows it, "text" says what happened in the product's voice, "tone" is ok, info or bad, and "undo" is true for a step that can be taken back. Each is shown in the demo.
  The page follows the refined requirements, never a fixed template. Most screens need no chart and no table: a booking flow is steps, a form and a summary; a catalogue is cards; a status page is a timeline; a settings page is a form and toggles. Add a chart only when a requirement says a trend or figure is watched, a table only when records are compared or scanned, cards only when things are chosen by picture. A screen that draws a block no requirement asks for fails review.
  Choose the block each requirement's wording asks for: something to browse or compare is a table or cards, a figure the user watches is stats, a trend is a chart, narrowing or finding is filters, something the user enters is a form, something the user triggers is actions. Keep cells and labels short.
  The same sample data is shown in every state of the screen (loading refreshes it in place, empty previews what fills the page, an error keeps the last good data behind the message), so give each block enough real rows and values to carry all of them.
- FULL DATA. For every screen with figures, tables, charts, cards, lists or timelines also give "mockFull": the same page (same title, same block types, same order) with fine-grained data, the way it looks on a busy real day. Tables 8 to 14 rows using every status the product has, with varied lengths, dates and amounts that agree with the stats above them; every chart with more points (up to 14) and a believable shape (a trend, a seasonal dip, a spike with a cause); cards, lists and timelines at their fullest; stats whose deltas are consistent with the charts. Densify only the block types the normal page already has, because they came from the requirements; add a second chart or a detail block only when a requirement itself has something worth plotting or reading closely. It is the screen as the business would show it in a sales demo.
  The loading state is drawn from the normal page: titles, labels, column headers, filters, buttons and navigation stay real, and only the data turns into skeleton shapes. So write the normal page with real headers and labels.
  "copy" holds the words for the states the screen has, in the product's own voice: emptyTitle and emptyHint (when it can be empty), error, success, validation (one plain sentence each).
  With a "locale" whose languages are not only English, write all sample content in English (code reads its statuses, amounts and dates), numbers with 0-9, dates in the locale's order and amounts in its currency, and give each page "tr": every word the page shows (title, subtitle, crumbs, tabs, labels, field labels and options, buttons, column headers, chips, statuses, chart titles, its layers', toasts' and states' words) with "from" exactly as written on the page and "to" in the other language, in its own script as a native speaker of the market writes it, never transliterated. Names of people, places, brands and codes stay as written. "mockFull" gets its own "tr" for words it adds.

- If design frames are listed in the request (F-1, F-2, ...), each image frame is one screen or one state of a screen: put its id in that screen's "frames". Do not leave an image frame unused and do not cite a frame that is not listed.
- If an approved earlier design is given, this is a change to it: keep the id, route, file and sample content of every screen that does not change, give new screens the next free ids, and drop a screen only when the new requirements remove it. Keep its look ("theme") exactly unless a requirement asks for a new one: the same product keeps its colours from one version to the next.
- If an existing-system summary is given, mark a screen "reuse" or "tweak" only when an existing page or shared component really covers it.
${UNTRUSTED_NOTE}`;

// "sample" alone is a real word in many fields (a blood sample, a sample pack), so only its placeholder uses are caught
const PLACEHOLDER = /lorem ipsum|\bitem \d\b|column [a-d]\b|test user|\bsample (?:user|name|item|text|data|product|title|company|customer|value|\d)\b|\bplaceholder\b|john doe|jane doe|foo bar|\bTBD\b/i;
// the words a mock shows, without its field names: a form field's "placeholder" key is not placeholder text
const textOf = (v: unknown): string => typeof v === "string" ? v : Array.isArray(v) ? v.map(textOf).join(" | ") : v && typeof v === "object" ? Object.values(v).map(textOf).join(" | ") : "";

/**
 * What makes the demo look finished rather than raw. Without "theme" the page falls back to a default look; a screen
 * without "mock" is drawn as a grey wireframe. Both are optional in the schema, so code insists on them for a request with UI
 * (a screen shown by an attached frame needs no mock) and the model is asked again with these reasons.
 */
export function designQuality(out: z.infer<typeof DesignOut>, existing = false, refs?: FitRefs, recent: Look[] = [], keptLook = false, fromRefs = false, screenIds?: string[]): { check: string; message: string }[] {
  const bad = lookQuality(out, existing, refs, recent, keptLook, fromRefs);
  for (const sc of out.screens) {
    if (!sc.mock) {
      if (!sc.frames.length) bad.push({ check: "design-no-mock", message: `Screen ${sc.id} has no "mock". Give it believable sample content (2 to 5 blocks) so the demo is not a wireframe.` });
      continue;
    }
    if (/^(page|screen|view|untitled|new page|home page)\s*\d*$/i.test(sc.mock.title.trim())) bad.push({ check: "design-generic-title", message: `Screen ${sc.id} is titled "${sc.mock.title}". Name each page for what it shows ("Find a flight", "My trips"): the lead talks about pages by name.` });
    if (sc.mock.blocks.length < 2) bad.push({ check: "design-thin-mock", message: `Screen ${sc.id} has only ${sc.mock.blocks.length} block. A real page has 2 to 5 (header figures, a table or cards, filters, actions).` });
    const hit = textOf(sc.mock).match(PLACEHOLDER);
    if (hit) bad.push({ check: "design-placeholder", message: `Screen ${sc.id} sample content contains placeholder text ("${hit[0]}"). Use real names, amounts, statuses and dates from the product's domain.` });
    // a page drawn on its own links to the screen list's ids
    const ids = new Set(screenIds ?? out.screens.map((x) => x.id));
    const named = sc.mock.blocks.flatMap((b) => (b.type === "actions" ? b.buttons.flatMap(btnLabels) : b.type === "form" ? [b.submit] : b.type === "table" ? b.rows.map((r) => r[0] ?? "") : b.type === "cards" || b.type === "list" || b.type === "results" || b.type === "notifications" ? b.items.map((i) => i.title) : b.type === "carousel" ? b.items.flatMap((i) => [i.title, ...(i.cta ? [i.cta] : [])]) : b.type === "kanban" ? b.columns.flatMap((c) => c.cards.map((k) => k.title)) : b.type === "map" ? b.pins.map((p) => p.label) : [...pressed(b)]));
    for (const l of sc.mock.links ?? []) {
      if (!ids.has(l.to) || l.to === sc.id) bad.push({ check: "design-link", message: `Screen ${sc.id} links "${l.from}" to ${l.to}, which is ${l.to === sc.id ? "the same screen" : "not a screen of this design"}. Link to another screen's id.` });
      if (!named.some((n) => n.trim().toLowerCase() === l.from.trim().toLowerCase())) bad.push({ check: "design-link", message: `Screen ${sc.id} links from "${l.from}", but nothing on the page is labelled that. Use the exact label of a button, the first cell of a table row, or the title of a card, list item or slide.` });
    }
    for (const o of sc.mock.overlays ?? []) {
      const labels = sc.mock.blocks.flatMap((b) => (b.type === "actions" ? b.buttons.flatMap(btnLabels) : b.type === "form" ? [b.submit] : b.type === "table" ? ["More", ...(b.bulk ?? []).flatMap(btnLabels)] : b.type === "carousel" ? b.items.flatMap((it) => (it.cta ? [it.cta] : [])) : pressed(b)));
      if (!labels.some((l) => l.trim().toLowerCase() === o.trigger.trim().toLowerCase())) bad.push({ check: "design-overlay-trigger", message: `Screen ${sc.id}'s ${o.kind} "${o.title}" opens from "${o.trigger}", but the page has no button with that label (it has: ${labels.map((l) => `"${l}"`).join(", ") || "none"}). Use the exact label of an actions button or form submit, or "More" for a table row's menu, adding the button if the page needs it.` });
      if (o.kind === "menu" && !o.items?.length) bad.push({ check: "design-overlay-trigger", message: `Screen ${sc.id}'s menu "${o.title}" has no "items".` });
    }
    // a toast follows something the person did on this page: a button, a slide's offer, or an overlay's action or menu item
    const doers = [
      ...sc.mock.blocks.flatMap((b) => (b.type === "actions" ? b.buttons.flatMap(btnLabels) : b.type === "form" ? [b.submit] : b.type === "table" ? (b.bulk ?? []).flatMap(btnLabels) : b.type === "carousel" ? b.items.flatMap((it) => (it.cta ? [it.cta] : [])) : pressed(b))),
      ...(sc.mock.overlays ?? []).flatMap((o) => [...o.actions.flatMap(btnLabels), ...(o.items ?? []), ...o.blocks.flatMap((b) => (b.type === "form" ? [b.submit] : []))]),
    ];
    for (const t of sc.mock.toasts ?? []) {
      if (!doers.some((l) => l.trim().toLowerCase() === t.after.trim().toLowerCase())) bad.push({ check: "design-toast-trigger", message: `Screen ${sc.id}'s toast "${t.text}" follows "${t.after}", but nothing on the page or in its overlays is labelled that (it has: ${doers.map((l) => `"${l}"`).join(", ") || "none"}). Use the exact label of the button, menu item or overlay action that shows it.` });
    }
    const dataTypes = ["stats", "table", "chart", "cards", "carousel", "list", "timeline", "detail", "calendar", "map", "gallery", "chat", "kanban", "reviews", "notifications", "results", "compare", "receipt"];
    if (sc.mock.blocks.some((b) => dataTypes.includes(b.type))) {
      if (!sc.mockFull) bad.push({ check: "design-no-full-mock", message: `Screen ${sc.id} has no "mockFull". Give the same page with fine-grained data (see FULL DATA) so the demo can show it dense and complete.` });
      else {
        const hit2 = textOf(sc.mockFull).match(PLACEHOLDER);
        if (hit2) bad.push({ check: "design-placeholder", message: `Screen ${sc.id} full-data content contains placeholder text ("${hit2[0]}"). Use real names, amounts, statuses and dates from the product's domain.` });
        const size = (m: { blocks: { type: string }[] }, t: string) => m.blocks.filter((b) => b.type === t).length;
        const missing = [...new Set(sc.mock.blocks.map((b) => b.type))].filter((t) => dataTypes.includes(t) && size(sc.mockFull!, t) < size(sc.mock!, t));
        if (missing.length) bad.push({ check: "design-thin-full-mock", message: `The full-data page of ${sc.id} is missing ${missing.join(", ")} that the normal page has. It must keep every data block and make each denser.` });
        // the things a busy day has more of, and how many each block can hold
        const many: Record<string, [(b: never) => number, number, string]> = {
          cards: [(b: { items: unknown[] }) => b.items.length, 9, "items"], list: [(b: { items: unknown[] }) => b.items.length, 10, "items"], timeline: [(b: { items: unknown[] }) => b.items.length, 10, "items"],
          notifications: [(b: { items: unknown[] }) => b.items.length, 14, "items"], results: [(b: { items: unknown[] }) => b.items.length, 12, "items"], reviews: [(b: { items: unknown[] }) => b.items.length, 10, "reviews"],
          gallery: [(b: { items: unknown[] }) => b.items.length, 16, "pictures"], chat: [(b: { messages: unknown[] }) => b.messages.length, 16, "messages"],
          kanban: [(b: { columns: { cards: unknown[] }[] }) => b.columns.reduce((a, c) => a + c.cards.length, 0), 0, "cards"],
        };
        for (const [t, [count, cap0, what]] of Object.entries(many)) {
          const of = (m: { blocks: { type: string }[] }) => m.blocks.filter((b) => b.type === t);
          const n = (m: { blocks: { type: string }[] }) => Math.max(0, ...of(m).map((b) => count(b as never)));
          const cap = cap0 || Math.max(0, ...of(sc.mock).map((b) => (b as unknown as { columns: unknown[] }).columns.length * 8)), base = n(sc.mock);
          if (base && n(sc.mockFull) <= base && base < cap - 1) bad.push({ check: "design-thin-full-mock", message: `The ${t} of the full-data page of ${sc.id} must show more ${what} than the normal page (up to ${cap}).` });
        }
        const rows = (m: { blocks: { type: string; rows?: unknown[]; points?: unknown[] }[] }, t: "rows" | "points") => Math.max(0, ...m.blocks.map((b) => b[t]?.length ?? 0));
        if (sc.mock.blocks.some((b) => b.type === "table") && rows(sc.mockFull as never, "rows") < 8) bad.push({ check: "design-thin-full-mock", message: `The tables of the full-data page of ${sc.id} have too few rows; give 8 to 14 varied rows with every status in use.` });
        if (sc.mock.blocks.some((b) => b.type === "chart" && OVER_TIME.has(b.kind)) && rows(sc.mockFull as never, "points") <= rows(sc.mock as never, "points") && rows(sc.mock as never, "points") < 14) bad.push({ check: "design-thin-full-mock", message: `The charts of the full-data page of ${sc.id} must have more points than the normal page (up to 14).` });
      }
    }
    const tbl = sc.mock.blocks.find((b) => b.type === "table");
    if (tbl && tbl.type === "table" && tbl.rows.length < 3) bad.push({ check: "design-thin-mock", message: `The table on ${sc.id} has ${tbl.rows.length} rows; give 4 to 6 varied rows so it reads like real data.` });
    for (const m of [sc.mock, sc.mockFull]) for (const b of m?.blocks ?? []) {
      if (b.type === "chart") bad.push(...chartFit(sc.id, b));
      bad.push(...domainFit(sc.id, b));
      if (b.type === "table" && b.sortBy !== undefined && b.sortBy >= b.columns.length) bad.push({ check: "design-table", message: `The table on ${sc.id} sorts by column ${b.sortBy}, but it has ${b.columns.length} columns (counted from 0).` });
    }
  }
  bad.push(...a11yFit(out));
  return bad;
}

/** The checks a screen list fails before any page is drawn: the look, the apps, and a missing theme. */
export function lookQuality(out: Pick<z.infer<typeof DesignOut>, "theme" | "apps"> & { screens: { id: string; app?: string | undefined }[] }, existing = false, refs?: FitRefs, recent: Look[] = [], keptLook = false, fromRefs = false): { check: string; message: string }[] {
  const bad: { check: string; message: string }[] = [];
  // proof the look comes from real products in the field: colours near the references, and the references cited
  // (a look taken from the client's references is checked against them instead: refFit)
  if (refs && !existing && !fromRefs) bad.push(...themeFit(out.theme, refs));
  // the look follows from this product's reading, and is not a recent project's again
  // (a change run that kept its approved look is not judged again: it may predate the reading)
  if ((refs || fromRefs) && !existing && out.theme && !keptLook) bad.push(...readingFit(out.theme), ...lookRepeats(out.theme, recent));
  // an existing app keeps its own look: no theme is drawn, the build follows the repo's tokens and components
  bad.push(...appsFit(out));
  if (!out.theme && !existing) bad.push({ check: "design-no-theme", message: 'No "theme". Choose the product look (brand colour, mode, radius, font, surface, motion) from the ART DIRECTION rules; without it the demo shows a default look.' });
  return bad;
}

/**
 * What would shut people out (WCAG 2.2 AA, the parts a design decides): text and controls too faint on their surfaces in each
 * mode the product shows, and form fields or buttons with no name a screen reader can say. Touch targets are the demo's own
 * (it sizes every control); the browser test measures them.
 */
export function a11yFit(out: z.infer<typeof DesignOut>): { check: string; message: string }[] {
  const bad: { check: string; message: string }[] = [];
  if (out.theme) {
    const v = themeValues(out.theme), modes = out.theme.mode === "auto" ? [false, true] : [out.theme.mode === "dark"];
    const NAME: Record<string, string> = { ink: "body text", ink2: "secondary text", mut: "muted text", a1: "the accent (links, focus)", a2: "the second accent", ok: "success", bad: "error", warn: "warning", info: "info", on: "button labels", br: "the brand colour", bg: "the page", sf: "cards", sf2: "raised grey surfaces" };
    for (const dark of modes) for (const i of contrastIssues(v.colours(dark), dark ? "dark" : "light")) {
      bad.push({ check: "design-a11y", message: `In ${i.mode} mode, ${NAME[i.text] ?? i.text} on ${NAME[i.on] ?? i.on} has a contrast of ${i.ratio}:1; it needs ${i.need}:1. ${i.text === "on" ? "Choose a deeper (or much lighter) brand colour so its button labels read." : "Choose a brand or accent colour with more contrast."}` });
    }
  }
  for (const sc of out.screens) for (const m of [sc.mock, sc.mockFull]) {
    for (const b of m?.blocks ?? []) {
      if (b.type === "form") for (const f of b.fields) if (!f.label.trim()) bad.push({ check: "design-a11y", message: `A ${f.kind} field on ${sc.id} has no label. Every field needs a visible label (a placeholder is not one): screen readers say it, and it stays when the field is filled.` });
      for (const t of [...pressed(b), ...(b.type === "actions" ? b.buttons.flatMap(btnLabels) : b.type === "table" ? (b.bulk ?? []).flatMap(btnLabels) : [])]) if (!t.trim()) bad.push({ check: "design-a11y", message: `A button in the ${b.type} on ${sc.id} has no label. Give every button a name, even an icon-only one (it becomes its tooltip and what screen readers say).` });
    }
    for (const o of sc.mock?.overlays ?? []) for (const t of o.actions.flatMap(btnLabels)) if (!t.trim()) bad.push({ check: "design-a11y", message: `A button in the ${o.kind} on ${sc.id} has no label. Give every button a name.` });
  }
  return [...new Map(bad.map((x) => [x.message, x])).values()].slice(0, 6);
}

// the chart kinds drawn along a time axis: a busy day gives them more points; shares, goals and readings keep theirs
const OVER_TIME = new Set(["bar", "line", "stacked"]);

/** A chart's numbers fit its kind: enough points, parts that match the series, shares that are not negative, percents for rings, a reading under its scale. */
export function chartFit(id: string, b: Extract<z.infer<typeof MockBlockFull>, { type: "chart" }>): { check: string; message: string }[] {
  const bad = (m: string) => [{ check: "design-chart", message: `The ${b.kind} chart "${b.title}" on ${id} ${m}` }];
  const n = b.points.length;
  if (OVER_TIME.has(b.kind) && n < 2) return bad("needs at least 2 points along its axis.");
  if (b.kind === "stacked") {
    if (!b.series?.length) return bad('needs "series" (2 to 4 names) and each point\'s "parts" in that order.');
    const off = b.points.filter((p) => p.parts?.length !== b.series!.length);
    if (off.length) return bad(`has ${b.series.length} series, but ${off.map((p) => `"${p.label}"`).join(", ")} ${off.length === 1 ? "has" : "have"} a different number of parts.`);
  }
  if (b.kind === "donut" && (n < 2 || n > 6 || b.points.some((p) => p.value < 0))) return bad("needs 2 to 6 shares, none negative.");
  if (b.kind === "progress" && (n > 4 || (!b.max && b.points.some((p) => p.value < 0 || p.value > 100)))) return bad('needs 1 to 4 goals, each a percent from 0 to 100 (or give "max" for the goal).');
  if (b.kind === "gauge" && (n !== 1 || !b.max || b.points[0]!.value > b.max || b.points[0]!.value < 0)) return bad('needs exactly one reading and "max", the top of its scale, with the reading between 0 and max.');
  return [];
}

type FullBlock = z.infer<typeof MockBlockFull>;
/** The buttons inside the other blocks: a plan's or a comparison's call to action, a toolbar's buttons (and their split menus), an alert's button. */
function pressed(b: FullBlock): string[] {
  return b.type === "plans" ? b.items.map((p) => p.cta) : b.type === "compare" && b.cta ? [b.cta] : b.type === "toolbar" ? b.buttons.flatMap(btnLabels) : b.type === "alert" && b.action ? [b.action] : [];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** An amount as written ("PKR 1,250.00", "-$5", "(12.50)", "1.250,00 €"); NaN when it is not one. */
export function amountOf(v: string): number {
  if (/^\s*(free|included|nil|—|–)\s*$/i.test(v)) return 0;
  const m = /\d[\d.,\s]*/.exec(v);
  if (!m) return NaN;
  let d = m[0].trim().replace(/\s/g, "");
  // a comma before the last two digits with dots before it is a decimal comma
  d = /,\d{1,2}$/.test(d) && (d.includes(".") || !/,\d{3}/.test(d)) ? d.replace(/\./g, "").replace(",", ".") : d.replace(/,/g, "");
  const n = parseFloat(d);
  return /^\s*\(|[-−]\s*\D{0,4}\d/.test(v) ? -n : n;
}

/**
 * The numbers inside a domain block agree with each other: a calendar is the real month and its picks fall on open days,
 * a route has stops, a chat has two sides, plans and comparisons line up, star shares add to 100, and a receipt adds up.
 */
export function domainFit(id: string, b: FullBlock): { check: string; message: string }[] {
  const bad: string[] = [];
  if (b.type === "calendar") {
    const beyond = [...b.marks.map((m) => m.day), ...b.off, ...(b.picked ? [b.picked] : [])].filter((d) => d > b.days);
    if (beyond.length) bad.push(`has days ${[...new Set(beyond)].join(", ")}, past the ${b.days} days of ${b.month}.`);
    if (b.picked && b.off.includes(b.picked)) bad.push(`picks day ${b.picked}, which is marked off.`);
    if (b.times?.length && !b.picked) bad.push('shows "times" but no "picked" day they belong to.');
    const lost = b.taken.filter((t) => !b.times?.includes(t));
    if (lost.length) bad.push(`marks ${lost.map((t) => `"${t}"`).join(", ")} taken, which ${lost.length === 1 ? "is" : "are"} not among its "times".`);
    if (b.time && (!b.times?.includes(b.time) || b.taken.includes(b.time))) bad.push(`picks the time "${b.time}", which is ${b.times?.includes(b.time) ? "taken" : "not among its times"}.`);
    const ym = /^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(b.month.trim());
    const mi = ym ? MONTHS.indexOf(ym[1]!.toLowerCase()) : -1;
    if (ym && mi >= 0) {
      const y = +ym[2]!, first = (new Date(Date.UTC(y, mi, 1)).getUTCDay() + 6) % 7, len = new Date(Date.UTC(y, mi + 1, 0)).getUTCDate();
      if (first !== b.startsOn || len !== b.days) bad.push(`is ${b.month}, which starts on ${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][first]} ("startsOn": ${first}) and has ${len} days; it has "startsOn" ${b.startsOn} and "days" ${b.days}.`);
    }
  }
  if (b.type === "map" && b.route && b.pins.length < 2) bad.push("draws a route with one stop; a route needs at least 2 pins in order.");
  if (b.type === "chat" && !(b.messages.some((m) => m.from === "me") && b.messages.some((m) => m.from === "them"))) bad.push(`has messages from one side only; a conversation with ${b.with} has both.`);
  if (b.type === "kanban" && !b.columns.some((c) => c.cards.length)) bad.push("has no cards in any column.");
  if (b.type === "plans") {
    if (b.items.filter((p) => p.featured).length > 1) bad.push("features more than one plan; raise one at most.");
    const noAlt = b.periods?.length ? b.items.filter((p) => !p.alt) : [];
    if (noAlt.length) bad.push(`switches between ${b.periods!.join(" and ")}, but ${noAlt.map((p) => `"${p.name}"`).join(", ")} ${noAlt.length === 1 ? "has" : "have"} no "alt" price for ${b.periods![1]}.`);
  }
  if (b.type === "reviews" && b.bars) {
    const sum = b.bars.reduce((a, x) => a + x, 0);
    if (sum < 95 || sum > 105) bad.push(`has star shares that add to ${Math.round(sum)}%; the five "bars" are percents of all reviews and add to 100.`);
  }
  if (b.type === "results") for (const f of b.facets) {
    const lost = f.kind === "check" ? f.picked.filter((p) => !f.options.includes(p)) : [];
    if (lost.length) bad.push(`ticks ${lost.map((p) => `"${p}"`).join(", ")} in "${f.title}", which ${lost.length === 1 ? "is" : "are"} not among its options.`);
  }
  if (b.type === "compare") {
    const off = b.rows.filter((r) => r.values.length !== b.items.length);
    if (off.length) bad.push(`compares ${b.items.length} things, but ${off.map((r) => `"${r.label}"`).join(", ")} ${off.length === 1 ? "has" : "have"} a different number of values.`);
    if (b.items.filter((i) => i.featured).length > 1) bad.push("features more than one of the things compared; tint one at most.");
  }
  if (b.type === "receipt") {
    const lines = b.lines.map((l) => amountOf(l.amount)), tot = b.totals.map((t) => amountOf(t.value));
    const near = (x: number, y: number) => Math.abs(x - y) <= Math.max(0.011, Math.abs(y) * 0.01);
    if (!lines.some(Number.isNaN) && !tot.some(Number.isNaN)) {
      const sum = lines.reduce((a, x) => a + x, 0), due = tot[tot.length - 1]!;
      if (tot.length === 1 && !near(due, sum)) bad.push(`has lines that add to ${+sum.toFixed(2)}, but "${b.totals[0]!.label}" is ${b.totals[0]!.value}.`);
      if (tot.length > 1 && /sub-?\s*total/i.test(b.totals[0]!.label)) {
        if (!near(tot[0]!, sum)) bad.push(`has lines that add to ${+sum.toFixed(2)}, but "${b.totals[0]!.label}" is ${b.totals[0]!.value}.`);
        const mid = b.totals.slice(1, -1);
        // a paid amount or a second total changes what "due" means, so only a plain subtotal, adjustments, total is added up
        if (!mid.some((t) => /total|paid|balance|due/i.test(t.label))) {
          const expect = tot[0]! + mid.reduce((a, t, i) => a + (/discount|promo|coupon|voucher|credit|refund|saving|\boff\b/i.test(t.label) ? -Math.abs(tot[i + 1]!) : tot[i + 1]!), 0);
          if (!near(due, expect)) bad.push(`has "${b.totals[0]!.label}" ${b.totals[0]!.value} and ${mid.map((t) => `${t.label} ${t.value}`).join(", ") || "nothing else"}, which make ${+expect.toFixed(2)}, but "${b.totals[tot.length - 1]!.label}" is ${b.totals[tot.length - 1]!.value}.`);
        }
      }
    }
  }
  return bad.map((m) => ({ check: "design-component", message: `The ${b.type} on ${id} ${m}` }));
}

const PHONE_SHELLS = ["tabs", "drawer", "minimal", "auto"];
/** More than one app: each has a unique id, a frame that suits its device, and every screen names one of them. */
export function appsFit(out: Pick<z.infer<typeof DesignOut>, "apps"> & { screens: { id: string; app?: string | undefined }[] }): { check: string; message: string }[] {
  const bad: { check: string; message: string }[] = [];
  const apps = out.apps ?? [];
  const ids = apps.map((a) => a.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) bad.push({ check: "design-app", message: `Two apps share the id ${[...new Set(dup)].join(", ")}.` });
  for (const a of apps) {
    if (a.device === "phone" && !PHONE_SHELLS.includes(a.shell)) bad.push({ check: "design-app", message: `The ${a.name} app is a phone app but its frame is "${a.shell}". A phone app uses tabs, drawer or minimal.` });
    if (a.device === "web" && a.shell === "tabs") bad.push({ check: "design-app", message: `The ${a.name} app is a web app with a bottom tab bar. Use sidebar, topbar, drawer or minimal.` });
    if (!out.screens.some((s) => s.app === a.id)) bad.push({ check: "design-app", message: `The ${a.name} app has no screens. Drop it, or give it the screens its users see.` });
  }
  for (const s of out.screens) {
    if (s.app && !ids.includes(s.app)) bad.push({ check: "design-app", message: `Screen ${s.id} belongs to app "${s.app}", which is not in "apps"${ids.length ? ` (${ids.join(", ")})` : ""}.` });
    else if (!s.app && apps.length > 1) bad.push({ check: "design-app", message: `Screen ${s.id} names no app. With more than one app, every screen says which app it is in.` });
  }
  return bad;
}

/** What the drawn demo showed wrong, as fixes the model can make: one per text and fault, with where it was seen. */
// the requirements ask for both colour modes: a dark mode beside the light one, a switch between them, or the system's choice
const BOTH_MODES = /\b(dark|night)[- ]mode\b|\b(light|dark)\s+(and|or|\/)\s+(light|dark)\b|\b(theme|appearance|colou?r[- ]scheme)\s+(switch|switcher|toggle|setting|preference)|\bsystem\s+(theme|appearance|colou?r[- ]scheme)\b/i;

/** A product the requirements give both colour modes is drawn in both ("auto"), so the demo has the switch and the card shows each page dark too. */
export function modeFit(out: { theme?: { mode?: string } | undefined }, reqText: string): { check: string; message: string }[] {
  const asked = reqText.match(BOTH_MODES)?.[0];
  if (!asked || out.theme?.mode === "auto") return [];
  return [{ check: "design-mode", message: `The requirements ask for "${asked}", but "theme.mode" is "${out.theme?.mode ?? "light"}". Set it to "auto": the product then follows the viewer's setting, the demo has a light/dark switch, and each page is shown in both modes.` }];
}

export function layoutFixes(issues: LayoutIssue[]): { check: string; message: string }[] {
  const by = new Map<string, { i: LayoutIssue; where: Set<string> }>();
  for (const i of issues) {
    const key = `${i.screen}|${i.kind}|${i.text}`;
    const e = by.get(key) ?? { i, where: new Set<string>() };
    e.where.add(`${i.state}, ${i.viewport} width`);
    by.set(key, e);
  }
  return [...by.values()].slice(0, 10).map(({ i, where }) => ({ check: "design-layout", message: `On ${i.screen}, "${i.text}" ${LAYOUT_FAULT[i.kind]} in the drawn demo (${[...where].slice(0, 3).join("; ")}). Shorten it (labels, cells, chips and buttons must fit a phone: about 20 characters), split it, or choose a block that gives it room.` }));
}

/**
 * Draws the demo of a design and measures it in a browser: its text (`issues`), and, for the screens listed in `read`, what each
 * shows as it first opens (`rendered`, for the reference layout check). Either is undefined when it could not be checked.
 */
async function demoLayout(title: string, out: z.infer<typeof DesignOut>, spec: Spec, read: string[] = []): Promise<{ issues?: LayoutIssue[]; rendered?: Record<string, RenderedLayout> }> {
  const dir = mkdtempSync(join(tmpdir(), "factory-design-"));
  try {
    const file = join(dir, "demo.html");
    writeFileSync(file, buildDemo({
      title, flow: out.flow, screens: out.screens, requirements: Object.fromEntries(spec.requirements.map((r) => [r.id, r.ears])), noScreen: out.noScreen,
      ...(out.theme ? { theme: out.theme } : {}), ...(out.apps?.length ? { apps: out.apps } : {}), ...(out.switcher ? { switcher: out.switcher } : {}),
      ...(out.locale ? { locale: out.locale } : {}),
    }));
    const issues = await checkDemoLayout(file, out.screens.map((sc) => ({ id: sc.id, route: sc.route, states: demoStates(sc), title: `"${sc.mock?.title ?? sc.route}" (${sc.id})` }))).catch(() => undefined);
    const rendered = read.length ? await readDemoLayout(file, read) : undefined;
    return { ...(issues ? { issues } : {}), ...(rendered ? { rendered } : {}) };
  } catch { return {}; } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The design frames listed in the request text (`- F-1 home.png`), in order. JSON exports are data, not screens. */
export function listedFrames(request: string): { id: string; name: string }[] {
  return [...request.matchAll(/^- (F-\d+) (.+?)\s*$/gm)].map((m) => ({ id: m[1]!, name: m[2]! })).filter((f) => !/\.json$/i.test(f.name));
}

/** Code's view of the links: which requirements no screen serves, and which screens serve none. */
export function mapDesign(reqIds: string[], out: z.infer<typeof DesignOut>, frameIds: string[] = []): { unmappedReqs: string[]; orphanScreens: string[]; unknown: string[]; duplicateIds: string[]; duplicateRoutes: string[]; unknownFrames: string[]; unusedFrames: string[] } {
  const dup = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
  const used = out.screens.flatMap((s) => s.frames);
  const known = new Set(reqIds);
  const served = new Set(out.screens.flatMap((s) => s.reqs));
  const exempt = new Set(out.noScreen.map((n) => n.req));
  return {
    unmappedReqs: reqIds.filter((r) => !served.has(r) && !exempt.has(r)),
    orphanScreens: out.screens.filter((s) => s.reqs.length === 0).map((s) => s.id),
    unknown: [...new Set([...out.screens.flatMap((s) => s.reqs), ...out.noScreen.map((n) => n.req)].filter((r) => !known.has(r)))],
    duplicateIds: dup(out.screens.map((s) => s.id)),
    // a route is the same route however it is cased or ends
    duplicateRoutes: dup(out.screens.map((s) => s.route.trim().toLowerCase().replace(/\/+$/, "") || "/")),
    unknownFrames: [...new Set(used.filter((f) => !frameIds.includes(f)))],
    unusedFrames: frameIds.filter((f) => !used.includes(f)),
  };
}

/** A repo whose UI already has pages and a design system (or partial one): the design extends it instead of inventing a look. */
export { hasExistingLook };

const RESTYLE_RULES = `RESTYLE. The "existing" section is this product's real UI, and the client chose to restyle the whole app to the match reference(s) listed below.
- Return "theme" from those references (their colours, type and corners), as for a new product: it replaces the app's tokens on every page.
- Keep the app's pages, routes, files and shared components: mark a screen "reuse" or "tweak" when an existing page or shared component covers it (it is restyled, not rebuilt), "new" only for a page that does not exist.
- Take the sample content from the same domain the existing pages show.`;

const EXISTING_RULES = `EXISTING APP. The "existing" section is this product's real UI. Extend it; do not restyle it.
- Do NOT return "theme": the app already has its look. The build will use the existing design tokens and shared components.
- Mark a screen "reuse" or "tweak" when an existing page or shared component covers it, "new" only for a page that does not exist, "design-system" only for a new shared component or token.
- Choose a route and file in the app's own structure (see its pages), and take the sample content from the same domain the existing pages show.`;

const NOTE_RULES = `You are a principal UI/UX engineer writing the design note for a SMALL change to an existing app (a label, a button, a field, a column, a fix on a page that exists). No demo is drawn: a person reads this note on the estimate card and approves both together.
- List each existing page the change touches: id S-1, S-2, ..., its route and file as in the "existing" section, the requirement ids it serves in "reqs", its size ("tweak" a change to the page, "reuse" built only from existing components, "new" only when there is truly no page to change) and "change": one or two plain sentences saying exactly what changes on that page and what stays as it is.
- "flow" is one sentence on how the user meets the change. Requirements that need no page go under "noScreen" with the reason.
- Keep the app's look, components and wording: name the existing components the change uses. Never propose a restyle.
${UNTRUSTED_NOTE}`;

/** The design note's shape: the pages a small change touches and what changes on each, in words. */
export const DesignNoteOut = z.object({
  flow: z.string().min(1).max(300),
  screens: z.array(z.object({
    id: z.string(), route: z.string().min(1), file: z.string().min(1), reqs: z.array(z.string()),
    size: z.enum(["new", "tweak", "design-system", "reuse"]).default("tweak"), change: z.string().min(1).max(400),
  })).min(1).max(4),
  noScreen: z.array(z.object({ req: z.string(), reason: z.string().min(1) })).default([]),
});

const STARTER_RULES = `NEW APP FROM A STARTER. There is no app yet; it is scaffolded from the starter in the "starter" section, whose components are listed there.
- Every screen is "new". Draw each screen with blocks those components cover, and mark a screen "design-system" only when it needs a shared component the starter does not have.
- Choose routes and sample content for this product; the starter has no pages of its own to follow.`;

const inventoryBrief = (inv: DesignInventory) => ({
  verdict: inv.verdict, tokens: inv.tokens.total, framework: inv.stack.framework, styling: inv.stack.styling, componentSystem: inv.stack.componentSystem,
  ...(inv.look ? { look: { read: inv.look.from, note: "the demo is drawn in this look; do not return a theme" } } : {}),
  pages: inv.pages.slice(0, 40), sharedComponents: [...inv.primitives, ...inv.composites].slice(0, 40).map((c) => (c as { name?: string }).name ?? c),
});

/** How many times a lead can send the design back before the run stops and asks for a different brief. */
export const MAX_DESIGN_REVISIONS = 4;

/** What the lead said when sending the design back, oldest first. The design is fixed or redrawn once for each. */
export function designRejections(s: RunState): string[] {
  return s.decisions.filter((d) => d.cardId.startsWith("design-") && d.decision === "reject")
    .map((d) => String((d as { reason?: string }).reason ?? "").trim() || "(no reason given)");
}


// ---------- sending a design back: fix what was named, or redraw ----------

type ScreenT = z.infer<typeof DesignOut>["screens"][number];
type Theme = z.infer<typeof DesignTheme>;
interface DesignArt { skipped?: boolean; flow: string; screens: ScreenT[]; apps?: z.infer<typeof DesignApp>[]; switcher?: z.infer<typeof Switcher>; locale?: DesignLocale; noScreen: { req: string; reason: string }[]; theme?: Theme; themeSource?: "new" | "repo"; mapping: { unmappedReqs: string[]; orphanScreens: string[] }; revision?: number; rework?: ReworkRound[]; figmaUrl?: string }

const cut = (from: string, to: string): string => RULES.slice(RULES.indexOf(from), RULES.indexOf(to));
const ART_RULES = (): string => cut("- ART DIRECTION.", "- MOCK CONTENT.");
const MOCK_RULES = (): string => cut("- MOCK CONTENT.", "- If design frames");

// ---------- a large request: the screen list first, then each page on its own ----------

/**
 * Above this many requirements the design is drawn in parts. One answer holding every page's sample content, full data and
 * translations does not fit the model's output: the 2026-10-05 estimate run (136 requirements) was cut off at 64K tokens
 * after 8.6 minutes, $1.52 thrown away, and the retry asked for the same answer again.
 */
// ponytail: counted in requirements, not screens (unknown before the list); a 7-requirement design was one screen, 2.5 KB
export const DRAW_IN_PARTS_AT = 24;
/** pages drawn at once */
const PAGES_SIDE_BY_SIDE = 4;

const PlanScreen = DesignOut.shape.screens.element.omit({ mock: true, mockFull: true }).extend({
  /** the page's name as its heading reads; the page call uses it as the mock's title */
  title: z.string().min(1).max(60),
  /** one sentence on what the user sees and does there: the page call's brief */
  purpose: z.string().min(1).max(240),
});
/** The screen list of a large request: every field of the design but the pages' content. */
export const DesignPlan = DesignOut.extend({ screens: z.array(PlanScreen).min(1) });
/** One page's content, drawn against the fixed screen list and look. */
export const DesignPage = z.object({ mock: ScreenMock, mockFull: ScreenMockFull.optional() });

const PLAN_PAGES = `- PAGES ARE DRAWN NEXT. This request is large, so here you only list the screens and choose the look; each page's content is drawn afterwards, one page per call, from your list. For every screen give "title" (the page's name as its heading reads: "Order history", never "Page 3") and "purpose" (one sentence: what the user sees and does there). Leave out "mock" and "mockFull".
`;
const PLAN_RULES = (): string => RULES.replace(MOCK_RULES(), PLAN_PAGES);

const PAGE_RULES = `You are a principal UI/UX engineer drawing ONE page of a design. The screen list, the flow and the look were decided first and are fixed: "design" holds them, "this-page" is the page to draw.
- Return "mock" for this page (and "mockFull" where FULL DATA asks for it), and nothing else. Its id, route, requirements, states and app stay as listed.
- Use the title in "this-page" as the mock's title, and draw what its "purpose" says for the requirements given.
- Links go only to the screen ids in the design's "pages": link a label to the page a user reaches from it.
- The look is fixed: draw for that theme (its shell, density, charts and imagery), not a new one.
- If an "earlier-page" is given, it was approved before: keep its content unless its requirements changed.
`;

/** The screen list's own checks: they name no page, or are about the list itself (links to requirements, ids, routes, frames, apps). */
const PLAN_CHECKS = new Set(["design-unknown-req", "design-unmapped", "design-orphan", "design-duplicate-id", "design-duplicate-route", "design-unknown-frame", "design-frame-unused", "design-app"]);
const names = (id: string, f: Failure) => new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(f.message);
/**
 * Which earlier failures a part of the drawing gets: a page those that name it, the screen list the rest. A runner failure (cut off,
 * timed out) was the one big answer's, so neither gets it. Parts with no failures send what they sent before, so a retry reads the
 * stored answer for every page that passed (src/estimate/cache.ts) and pays only for the rest.
 */
export function failuresFor(failures: Failure[], page?: string): Failure[] {
  const own = failures.filter((f) => !f.check.startsWith("runner-"));
  if (page) return own.filter((f) => !PLAN_CHECKS.has(f.check) && names(page, f));
  return own.filter((f) => PLAN_CHECKS.has(f.check) || !/\bS-\d+\b/.test(f.message));
}

interface PartsBrief {
  spec: Spec; reqText: string; frames: string[];
  /** the mode's own rules (existing app, restyle, starter, references), as in the one-answer call */
  rules: ResolvedSection[];
  /** the one-answer call's briefing sections (requirements, earlier design, existing app, references, recent looks, feedback) */
  context: ResolvedSection[];
  existing: boolean; refs: FitRefs; recent: Look[]; fromRefs: boolean; earlierTheme?: Theme | undefined;
  inv?: DesignInventory | undefined; reading?: DesignRefsArt | undefined; earlierScreens: ScreenT[]; feedback: string;
  /** pages the lead called fine: kept as they were when the list keeps their id and route */
  fine: ScreenT[];
}

/**
 * The design as far as it is drawn, as the run's preview (Run: Preview in `factory ui`): drawn pages as they will look, the rest
 * as wireframes, marked a draft so the page says how far it is. design-baseline writes the real preview over it. Best effort: a
 * draft that cannot be written never stops the drawing. Files are swapped in whole, so the page never reads half a file.
 */
export function draftPreview(ctx: Pick<StepContext, "ledger" | "state" | "runId" | "log">, spec: Spec, plan: z.infer<typeof DesignPlan>, drawn: Map<string, ScreenT>, n: { drawn: number; total: number; failed: number }): void {
  try {
    const screens = plan.screens.map(({ title: _t, purpose: _p, ...x }) => drawn.get(x.id) ?? x);
    const html = buildDemo({
      title: ctx.state.info.estimate?.projectName ?? ctx.runId, flow: plan.flow, screens: screens.map((x) => ({ ...x, states: x.states ?? [], size: x.size ?? "new", frames: x.frames ?? [] })),
      requirements: Object.fromEntries(spec.requirements.map((q) => [q.id, q.ears])), noScreen: plan.noScreen ?? [],
      ...(plan.theme ? { theme: plan.theme } : {}), ...(plan.apps?.length ? { apps: plan.apps } : {}), ...(plan.switcher ? { switcher: plan.switcher } : {}), ...(plan.locale ? { locale: plan.locale } : {}),
    });
    const dir = join(ctx.ledger.dir, "preview");
    mkdirSync(dir, { recursive: true });
    const put = (name: string, body: string) => { writeFileSync(join(dir, `.${name}.tmp`), body); renameSync(join(dir, `.${name}.tmp`), join(dir, name)); };
    put("index.html", html);
    put("preview.json", JSON.stringify({
      site: { entry: "index.html", screens: plan.screens.map((x) => ({ path: `index.html#${x.id}`, title: drawn.get(x.id)?.mock?.title ?? x.title, ...(x.reqs[0] ? { req: x.reqs[0] } : {}), ...(drawn.has(x.id) ? {} : { pending: true }) })) },
      images: [], draft: n,
    }, null, 2));
  } catch (e) { ctx.log(`design: draft preview not written: ${(e as Error).message}`); }
}

/**
 * A large request's design: one call lists the screens and chooses the look (checked before any page is paid for), then each page
 * is drawn on its own against that list, a few at a time, with one more try for a page that fails its checks. The result has the
 * one-answer call's shape, so the step's checks and the demo measure it the same way.
 */
async function drawInParts(ctx: StepContext, b: PartsBrief): Promise<{ ok: true; output: z.infer<typeof DesignOut>; model: string; risks: string[] } | { ok: false; outcome: StepOutcome }> {
  const p = await think({ ...ctx, priorFailures: failuresFor(ctx.priorFailures) }, {
    stage: "design", label: "design screen list", route: "design", cls: "read-large", budgetTokens: 80000, tools: [], schema: DesignPlan, maxTurns: 3,
    sections: [S.template("tpl", PLAN_RULES()), ...b.rules, ...b.context, S.task("List the screens and choose the look; the pages are drawn next.")],
  });
  if (!p.ok) return p;
  const plan = p.output;
  const keptLook = !!b.earlierTheme && JSON.stringify(b.earlierTheme) === JSON.stringify(plan.theme);
  const listed = [
    ...mapFailures(mapDesign(b.spec.requirements.map((q) => q.id), plan as never, b.frames)),
    ...[...lookQuality(plan, b.existing, b.refs, b.recent, keptLook, b.fromRefs), ...a11yFit({ screens: [], theme: plan.theme } as never), ...modeFit(plan, b.reqText)].map((q) => failure(q.check, q.message)),
  ];
  // after the rounds of questions about failing checks, what still fails is carried as an open risk (src/stages/gate-questions.ts)
  const risks: string[] = [];
  if (listed.length && carries(ctx, listed)) risks.push(...carriedLines("the design checks", listed));
  else if (listed.length) {
    p.forget?.();
    return { ok: false, outcome: { kind: "fail", category: "other", failures: listed, signature: `design-plan:${[...new Set(listed.map((f) => f.check))].sort().join(",")}`, gate: true } };
  }

  const ids = plan.screens.map((x) => x.id);
  const ears = new Map(b.spec.requirements.map((q) => [q.id, q.ears]));
  const design = {
    flow: plan.flow, ...(plan.theme ? { theme: plan.theme } : {}), ...(plan.locale ? { locale: plan.locale } : {}), ...(plan.apps?.length ? { apps: plan.apps } : {}),
    pages: plan.screens.map((x) => ({ id: x.id, title: x.title, route: x.route, ...(x.app ? { app: x.app } : {}) })),
  };
  ctx.log(`design: ${plan.screens.length} screens listed; drawing each page, ${PAGES_SIDE_BY_SIDE} at a time (Preview shows them as they come)`);
  // the preview fills in as pages come back; the trace counts them
  const total = plan.screens.length;
  const shown = new Map<string, ScreenT>();
  let finished = 0;
  let failedPages = 0;
  const progress = (id: string, title: string, screen?: ScreenT, how = "drawn") => {
    finished++;
    if (screen) shown.set(id, screen); else failedPages++;
    ctx.log(`design: page ${finished} of ${total} ${screen ? how : "failed its checks twice"}: ${id} "${title}"`);
    draftPreview(ctx, b.spec, plan, shown, { drawn: shown.size, total, failed: failedPages });
  };
  draftPreview(ctx, b.spec, plan, shown, { drawn: 0, total, failed: 0 });
  const drawn = await inPool(plan.screens, PAGES_SIDE_BY_SIDE, async ({ title, purpose, ...entry }): Promise<{ screen: ScreenT; risks?: string[] } | { failures: Failure[] } | { outcome: StepOutcome }> => {
    const kept = b.fine.find((x) => x.id === entry.id && x.route === entry.route);
    if (kept) { progress(entry.id, title, kept, "kept as approved"); return { screen: kept }; }
    const earlierPage = b.earlierScreens.find((x) => x.id === entry.id);
    const cited = b.reading && entry.refs?.length ? { ...b.reading, refs: b.reading.refs.filter((r) => entry.refs!.includes(r.id)) } : undefined;
    let failures = failuresFor(ctx.priorFailures, entry.id);
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await think({ ...ctx, priorFailures: failures }, {
        stage: "design", label: `design ${entry.id} "${title}"`, route: "design", cls: "read-large", budgetTokens: 30000, tools: [], schema: DesignPage, maxTurns: 3,
        sections: [
          S.template("tpl", PAGE_RULES + MOCK_RULES() + UNTRUSTED_NOTE),
          ...(cited?.refs.length ? [S.template("ref-rules", `${REF_RULES}\n${UNTRUSTED_IMAGE_NOTE}`)] : []),
          S.artifact("design", "design-plan", design),
          S.artifact("this-page", "design-plan", { ...entry, title, purpose }),
          S.artifact("requirements", "spec", entry.reqs.map((id) => ({ id, ears: ears.get(id) ?? "" }))),
          ...(earlierPage ? [S.artifact("earlier-page", "approved-design", earlierPage)] : []),
          ...(b.inv ? [S.artifact("existing", "existing-ui", inventoryBrief(b.inv))] : []),
          ...(cited?.refs.length ? referenceSections(ctx.state, cited) : []),
          ...(b.feedback ? [S.reference("design-feedback", b.feedback)] : []),
          S.task(`Draw page ${entry.id}, "${title}".`),
        ],
      });
      if (!r.ok) return { outcome: r.outcome };
      const screen: ScreenT = { ...entry, ...r.output };
      // the page alone: its app is checked with the list, its links against the list's ids
      const bad = designQuality({ flow: plan.flow, noScreen: [], screens: [{ ...screen, app: undefined }], ...(plan.theme ? { theme: plan.theme } : {}) } as never, b.existing, undefined, [], true, false, ids);
      if (!bad.length) { progress(entry.id, title, screen); return { screen }; }
      const fs = bad.map((q) => failure(q.check, q.message));
      if (attempt === 1 && carries(ctx, fs)) { progress(entry.id, title, screen, "drawn (its failing checks carried as open risks)"); return { screen, risks: carriedLines(`the checks of page ${entry.id}`, fs) }; }
      r.forget?.();
      failures = fs;
    }
    progress(entry.id, title);
    return { failures };
  });
  const stopped = drawn.find((d): d is { outcome: StepOutcome } => "outcome" in d);
  if (stopped) return { ok: false, outcome: stopped.outcome };
  const failed = drawn.flatMap((d) => ("failures" in d ? d.failures : []));
  if (failed.length) return { ok: false, outcome: { kind: "fail", category: "other", failures: failed, signature: `design-pages:${[...new Set(failed.map((f) => f.check))].sort().join(",")}`, gate: true } };
  ctx.log(`design: ${plan.screens.length} pages drawn`);
  const { screens: _listed, ...rest } = plan;
  return { ok: true, output: { ...rest, screens: drawn.map((d) => (d as { screen: ScreenT }).screen) }, model: p.model, risks: [...risks, ...drawn.flatMap((d) => ("risks" in d && d.risks ? d.risks : []))] };
}

/** The links between requirements, screens and frames, as failures. */
function mapFailures(map: ReturnType<typeof mapDesign>): Failure[] {
  return [
    ...map.unknown.map((x) => failure("design-unknown-req", `${x} is not a requirement in the spec`)),
    ...map.unmappedReqs.map((x) => failure("design-unmapped", `${x} is on no screen and not listed under noScreen`)),
    ...map.orphanScreens.map((x) => failure("design-orphan", `screen ${x} serves no requirement`)),
    ...map.duplicateIds.map((x) => failure("design-duplicate-id", `two screens share the id ${x}`)),
    ...map.duplicateRoutes.map((x) => failure("design-duplicate-route", `two screens share the route ${x}; one screen has one route (give states, not a second screen)`)),
    ...map.unknownFrames.map((x) => failure("design-unknown-frame", `${x} is not one of the attached frames`)),
    ...map.unusedFrames.map((x) => failure("design-frame-unused", `attached frame ${x} is on no screen`)),
  ];
}

const PATCH_SCREEN = `You are a principal UI/UX engineer fixing ONE page of an approved design after the lead sent it back. Return that page as "screen" with the same id, route, file and requirement ids.
- Change only what the feedback asks. Keep everything else on the page as it is: its title, blocks, states and sample content.
- The look (the theme) is fixed: use it as given. The other pages are only there so this one stays consistent with them.
- Name and words stay the lead's: the page keeps a clear title for what it shows.
`;
const PATCH_DATA = `This is a sample-content fix: keep the page's blocks, their types and their order exactly; change only the sample content (names, amounts, dates, rows, labels), and keep "mockFull" in step with it.
`;
const PATCH_LOOK = `You are a principal UI/UX engineer changing only the LOOK of an approved design after the lead sent it back. Return "theme" only: the pages and their content stay as they are and are not yours to change.
`;

const reqLines = (spec: Spec) => spec.requirements.map((q) => ({ id: q.id, ears: q.ears }));
const asks = (items: { quote: string; change: string }[]) => items.map((i, n) => `${n + 1}. The lead said: "${i.quote}". Change: ${i.change}`).join("\n");

interface Reworked { done?: { design: DesignArt }; redraw?: { round: ReworkRound; fine: string[] } }

/**
 * A design that was sent back. A cheap model reads the lead's reason against a compact index, code decides whether to fix the
 * named parts or redraw, and the parts are fixed one call each. Anything doubtful, or any fix that fails its checks twice,
 * falls back to the full redraw, so the worst case is the old behaviour plus a small triage call.
 */
async function reworkDesign(ctx: Parameters<StepDef["run"]>[0], spec: Spec, prev: DesignArt, reasons: string[], inv: DesignInventory | undefined): Promise<Reworked> {
  const existing = hasExistingLook(inv);
  const round = reasons.length;
  const earlier = reasons.slice(0, Math.max(0, (prev.revision ?? 0)));
  const fresh = reasons.slice(prev.revision ?? 0);
  const redraw = (plan: ReworkPlan | { mode: "redraw"; why: "failed" }, t?: Triage): Reworked => ({ redraw: { round: roundOf({ round, plan, ...(t ? { t } : {}), design: prev }), fine: (t?.fine ?? []) } });
  const tr = await think(ctx, {
    stage: "design", route: "design-triage", cls: "read-small", budgetTokens: 14000, tools: [], schema: Triage, maxTurns: 2,
    sections: [
      S.template("tpl", TRIAGE_RULES),
      S.artifact("design-index", "approved-design", designIndex(prev, reqLines(spec))),
      ...(earlier.length ? [S.reference("earlier-feedback", `Earlier notes from the lead, already answered:\n${earlier.map((x, i) => `${i + 1}. ${x}`).join("\n")}`)] : []),
      S.reference("feedback", `The lead's note on this design:\n${fresh.map((x) => `- ${x}`).join("\n")}`),
      S.task("Say which parts of the design to fix."),
    ],
  });
  if (!tr.ok) return redraw({ mode: "redraw", why: "vague" });
  const t = tr.output;
  const plan = decideRework(t, prev);
  if (plan.mode === "redraw") return redraw(plan, t);
  if (plan.mode === "patch" && plan.look && existing) return redraw({ mode: "redraw", why: "vague" }, t);
  const finish = (design: DesignArt, patched: string[], p: ReworkPlan): Reworked => {
    const r = roundOf({ round, plan: p, t, design, patched });
    return { done: { design: { ...design, revision: reasons.length, rework: [...(prev.rework ?? []), r] } } };
  };
  if (plan.mode === "none") return finish(prev, [], plan);

  const reqText = spec.requirements.map((q) => q.ears).join("\n");
  const others = (id: string) => prev.screens.filter((x) => x.id !== id).map((x) => ({ id: x.id, title: screenName(x), route: x.route }));
  let theme = prev.theme;
  const history = (x: string) => (earlier.length ? [S.reference(`earlier-${x}`, `Earlier notes from the lead (do not undo these fixes):\n${earlier.map((e, i) => `${i + 1}. ${e}`).join("\n")}`)] : []);

  if (plan.look) {
    const items = plan.items.filter((i) => i.part === "look");
    await ensureMeasured(pickIndustries(reqText).map((p) => p.industry.id)).catch(() => undefined);
    const refs = fitRefs(reqText);
    const field = fieldOf(reqText);
    const recent = recentLooks(lookKey(ctx.state.info.estimate?.projectName, ctx.runId), undefined, field);
    let failures: string[] = [], got: Theme | undefined;
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      const r = await think(ctx, {
        stage: "design", route: "design", cls: "read-large", budgetTokens: 24000, tools: [], schema: z.object({ theme: DesignTheme }), maxTurns: 3,
        sections: [
          S.template("tpl", PATCH_LOOK + ART_RULES() + UNTRUSTED_NOTE),
          S.artifact("requirements", "spec", reqLines(spec)),
          S.artifact("current-look", "approved-design", prev.theme),
          S.artifact("pages", "approved-design", prev.screens.map((x) => ({ title: screenName(x), route: x.route, blocks: x.mock?.blocks.map((b) => b.type) }))),
          S.reference("design-references", `Design references (how real products in this field look):\n${briefFor(reqText)}`),
          ...(recent.length ? [S.reference("recent-looks", lookBrief(recent, field))] : []),
          S.reference("feedback", `Change the look as the lead asked:\n${asks(items)}`),
          ...history("look"),
          ...(failures.length ? [S.reference("failures", `Your previous attempt was rejected:\n${failures.map((f) => `- ${f}`).join("\n")}`)] : []),
          S.task("Return the new theme."),
        ],
      });
      if (!r.ok) return redraw({ mode: "redraw", why: "failed" }, t);
      failures = [...themeFit(r.output.theme, refs), ...readingFit(r.output.theme), ...lookRepeats(r.output.theme, recent)].map((x) => x.message);
      if (!failures.length) got = r.output.theme;
    }
    if (!got) return redraw({ mode: "redraw", why: "failed" }, t);
    theme = got;
  }

  const screens = [...prev.screens];
  for (const id of plan.screens) {
    const at = screens.findIndex((x) => x.id === id), old = screens[at]!;
    const items = plan.items.filter((i) => i.part !== "look" && i.screen === id);
    const dataOnly = items.every((i) => i.part === "data");
    let failures: string[] = [], got: ScreenT | undefined;
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      const r = await think(ctx, {
        stage: "design", route: "design", cls: "read-large", budgetTokens: 30000, tools: [], schema: z.object({ screen: DesignOut.shape.screens.element }), maxTurns: 3,
        sections: [
          S.template("tpl", PATCH_SCREEN + (dataOnly ? PATCH_DATA : "") + MOCK_RULES() + UNTRUSTED_NOTE),
          S.artifact("requirements", "spec", reqLines(spec)),
          ...(theme ? [S.artifact("look", "approved-design", theme)] : []),
          S.artifact("other-pages", "approved-design", others(id)),
          S.artifact("this-page", "approved-design", old),
          S.reference("feedback", `Fix this page as the lead asked:\n${asks(items)}`),
          ...history("page"),
          ...(failures.length ? [S.reference("failures", `Your previous attempt was rejected:\n${failures.map((f) => `- ${f}`).join("\n")}`)] : []),
          S.task("Return the fixed page."),
        ],
      });
      if (!r.ok) return redraw({ mode: "redraw", why: "failed" }, t);
      const nw = r.output.screen, bad: string[] = [];
      if (nw.id !== old.id || nw.route !== old.route || nw.file !== old.file) bad.push(`keep the id ${old.id}, route ${old.route} and file ${old.file}`);
      if ([...nw.reqs].sort().join() !== [...old.reqs].sort().join()) bad.push(`keep the same requirements (${old.reqs.join(", ")})`);
      if (dataOnly && JSON.stringify(nw.mock?.blocks.map((b) => b.type)) !== JSON.stringify(old.mock?.blocks.map((b) => b.type))) bad.push("keep the same block types in the same order; this is a sample-content fix only");
      bad.push(...designQuality({ flow: prev.flow, noScreen: [], screens: [nw], ...(theme ? { theme } : {}) } as never, existing).map((q) => q.message));
      failures = bad;
      if (!bad.length) got = nw;
    }
    if (!got) return redraw({ mode: "redraw", why: "failed" }, t);
    screens[at] = got;
  }
  return finish({ ...prev, screens, ...(theme ? { theme } : {}) }, [...(plan.look ? ["look"] : []), ...plan.screens], plan);
}

/**
 * What code guarantees after a full redraw, whatever the model returned: a page the lead called fine comes back exactly as it was
 * (when the redraw kept its id and route), and a change request keeps the approved look when the model gave none.
 */
export function keepFine(out: z.infer<typeof DesignOut>, fine: string[], prev: DesignArt | undefined, earlierTheme: Theme | undefined): z.infer<typeof DesignOut> {
  const screens = out.screens.map((sc) => {
    const old = fine.includes(sc.id) ? prev?.screens.find((x) => x.id === sc.id && x.route === sc.route) : undefined;
    return old ? { ...old } : sc;
  });
  return { ...out, screens, ...(!out.theme && earlierTheme ? { theme: earlierTheme } : {}) };
}

/** The client's references for the design call: the typed reading (trusted), their words (untrusted) and their pictures. */
function referenceSections(state: RunState, reading: DesignRefsArt) {
  const notes = refNotes(reading);
  const byId = new Map((state.info.references ?? []).map((r) => [r.id, r]));
  return [
    S.artifact("client-references", "references", clientRefBrief(reading)),
    ...(notes ? [S.untrusted("client-reference-notes", "reference notes", `What the reading and the client said about the references:\n${notes}`)] : []),
    ...reading.refs.flatMap((r) => (byId.get(r.id)?.images ?? []).map((im, k) => S.image(`${r.id}-img-${k + 1}`, `${r.id} ${im.label}`, im.sha, `${r.id} (${r.role}), ${im.label}`))),
  ];
}

/** The match references the person chose on the questions card to restyle the app to (undefined: keep the app's look). */
const restyleOf = (s: RunState, l: Ledger): string[] | undefined => restyleChosen(readOutput<ClarifyResult>(s, l, "clarify"));

/** A match reference's measured fonts on the theme (set by code; the model only picks the styles). */
function withFamilies(theme: Theme, reading: DesignRefsArt | undefined, use: RefUse[] | undefined): Theme {
  const f = matchFamilies(reading, (use ?? []).filter((u) => u.use === "set-aside").map((u) => u.id));
  return f ? { ...theme, families: f } : theme;
}

/**
 * The design step for any mode: `src` names the steps it reads (the estimate's by default). The key,
 * template version and inputs are the same for every mode, so the estimate's runs replay unchanged.
 */
/** The design step's template version (recorded in each design package). */
export const DESIGN_TEMPLATE_VERSION = "21";

export function makeDesignStep(src: DesignSources = ESTIMATE_SOURCES): StepDef {
  return {
    key: "design", stage: "design", templateVersion: DESIGN_TEMPLATE_VERSION,
    inputs: (s, l) => {
      if (!sourcesReady(s, src)) return undefined;
      // with references the design waits for their reading (design-refs); without, the inputs are what they always were
      const refRead = s.info.references?.length ? outputOf(s, "design-refs") : undefined;
      if (s.info.references?.length && !refRead) return undefined;
      const ui = !!l.getJson<Intent>(s.steps.get(src.intent)!.outputs[0]!)?.touchesUi;
      // the restyle chosen on the questions card (runs with match references and an app of their own only)
      const restyle = s.info.references?.length ? !!restyleOf(s, l) : false;
      return { spec: s.steps.get(src.spec)!.outputs[0], ui, ...(refRead ? { refRead } : {}), ...(restyle ? { restyle } : {}), inventory: inventoryNamed(s, src), ...(src.components ? { starter: src.components } : {}), earlier: s.info.parent?.kind === "change" ? s.info.parent.designSha : undefined, frames: listedFrames(s.info.request ?? "").map((f) => f.id), rejections: designRejections(s).slice(0, MAX_DESIGN_REVISIONS) };
    },
    async run(ctx) {
      const intent = intentOf<Intent>(ctx.state, ctx.ledger, src);
      // no UI: nothing to draw; E1b passes on the intent alone
      if (!intent.touchesUi) return { kind: "done", outputs: { design: ctx.ledger.putJson({ header: header(ctx.runId, "design", "design", ""), skipped: true, reason: "no UI in this request" }) }, data: { skipped: true } };
      // a spec from before problems were settled by questions, which the breakdown would refuse: settle it before drawing from it
      const back = await backToSettle(ctx, "design", src.spec);
      if (back) return back;
      const spec = specOf<Spec>(ctx.state, ctx.ledger, src);
      const inv = repoInventory(ctx, src);
      const frames = listedFrames(ctx.state.info.request ?? "");
      const p = ctx.state.info.parent;
      const earlier = p?.kind === "change" && p.designSha ? ctx.ledger.getJson<{ skipped?: boolean; flow: string; screens: unknown[]; theme?: Theme; locale?: DesignLocale }>(p.designSha) : undefined;
      const reqText = spec.requirements.map((q) => q.ears).join("\n");
      // a small UI fix in an app of its own: a text note approved with the estimate (a note that needs a new page falls through to the full design)
      if (lightUi(intent, { existingLook: hasExistingLook(inv), frames: frames.length, references: ctx.state.info.references?.length ?? 0, earlierDesign: !!earlier && !earlier.skipped, reqs: spec.requirements.length, off: ctx.project.design?.lightNote === false })) {
        const n = await designNote(ctx, spec, inv!);
        if (n && "outcome" in n) return n.outcome;
        if (n) return { kind: "done", outputs: { design: ctx.ledger.putJson({ ...n.note, header: header(ctx.runId, "design", "design", "", n.model) }) }, data: { screens: n.note.screens.length, note: true, ...(n.risks.length ? { openRisks: n.risks } : {}) } };
      }
      const sentBack = designRejections(ctx.state).slice(0, MAX_DESIGN_REVISIONS);
      // a design that was sent back is fixed where the lead pointed, or redrawn when that is what the note needs
      const prevSha = ctx.state.steps.get("design")?.outputs[0];
      const prev = sentBack.length && prevSha ? ctx.ledger.getJson<DesignArt>(prevSha) : undefined;
      let again: { round: ReworkRound; fine: string[] } | undefined;
      if (prev && !prev.skipped && prev.screens?.length && (prev.revision ?? 0) < sentBack.length) {
        const rw = await reworkDesign(ctx, spec, prev, sentBack, inv);
        if (rw.done) {
          const d = rw.done.design;
          return { kind: "done", outputs: { design: ctx.ledger.putJson({ ...d, header: header(ctx.runId, "design", "design", "") }) }, data: { screens: d.screens.length, states: d.screens.reduce((n, x) => n + Math.max(1, (x.states ?? []).length), 0), rework: d.rework![d.rework!.length - 1]!.mode } };
        }
        again = rw.redraw;
      }
      // the client's references, as the design-refs step read them (runs with references only)
      const refsSha = outputOf(ctx.state, "design-refs");
      const refRead = refsSha ? ctx.ledger.getJson<DesignRefsArt & { skipped?: boolean }>(refsSha) : undefined;
      const reading = refRead && !refRead.skipped && refRead.refs.length ? refRead : undefined;
      // the app keeps its own look unless the person chose, on the questions card, to restyle it to the match references
      const restyle = !!reading && hasExistingLook(inv) && !!restyleOf(ctx.state, ctx.ledger);
      const existing = hasExistingLook(inv) && !restyle;
      // no app of its own: the mode's fixed component list (a starter template's), when it gives one
      const starter = !hasExistingLook(inv) && src.components?.components.length ? src.components : undefined;
      // a look taken from match or inspire references replaces the field's library; layout references leave the look to it
      const fromRefs = !!reading && lookFromRefs(reading) && !existing;
      const matchOnly = fromRefs && lookRefs(reading).every((r) => r.role === "match");
      // about to draw: read the live sites of the field's brands first (best effort), so the brief and the colour check use real colours
      if (!existing && !fromRefs) await ensureMeasured(pickIndustries(reqText).map((x) => x.industry.id)).catch(() => undefined);
      const refBrief = briefFor(reqText);
      const refs = fitRefs(reqText);
      // a new look is compared with the factory's latest projects; a change keeps its approved look, and an existing app keeps the repo's
      const field = fieldOf(reqText);
      // (a client's brand may repeat an earlier project's: no recent-looks check when every look reference is matched)
      const recent = existing || restyle || (earlier && !earlier.skipped) || matchOnly ? [] : recentLooks(lookKey(ctx.state.info.estimate?.projectName, ctx.runId), undefined, field);
      const feedback = sentBack.length
        ? `The lead rejected the previous design ${sentBack.length === 1 ? "once" : `${sentBack.length} times`}. Their reasons, oldest first:\n${sentBack.map((x, i) => `${i + 1}. ${x}`).join("\n")}\nRedraw it so each reason is met: keep what they did not criticise, change what they did, and do not repeat the earlier screens, theme or sample data where they objected.${again?.fine.length && prev ? ` The lead said these pages are fine, so keep them as they are: ${prev.screens.filter((x) => again!.fine.includes(x.id)).map(screenName).join(", ")}.` : ""}`
        : "";
      const rules = [
        ...(existing ? [S.template("existing-rules", EXISTING_RULES)] : restyle ? [S.template("restyle-rules", RESTYLE_RULES)] : starter ? [S.template("starter-rules", STARTER_RULES)] : []),
        ...(reading ? [S.template("ref-rules", `${REF_RULES}\n${UNTRUSTED_IMAGE_NOTE}`)] : []),
      ];
      const context = [
        S.artifact("requirements", "spec", spec.requirements.map((q) => ({ id: q.id, ears: q.ears }))),
        ...(earlier && !earlier.skipped ? [S.artifact("approved-design", "approved-design", { flow: earlier.flow, screens: earlier.screens, ...(earlier.theme ? { theme: earlier.theme } : {}), ...(earlier.locale ? { locale: earlier.locale } : {}) })] : []),
        ...(inv ? [S.artifact("existing", "existing-ui", inventoryBrief(inv))] : []),
        ...(starter ? [S.artifact("starter", "starter-components", starter)] : []),
        ...(fromRefs ? [] : [S.reference("design-references", `Design references (how real products in this field look):\n${refBrief}`)]),
        ...(reading ? referenceSections(ctx.state, reading) : []),
        ...(recent.length ? [S.reference("recent-looks", lookBrief(recent, field))] : []),
        ...(feedback ? [S.reference("design-feedback", feedback)] : []),
      ];
      const earlierTheme = earlier && !earlier.skipped ? earlier.theme : undefined;
      const r = spec.requirements.length > DRAW_IN_PARTS_AT
        ? await drawInParts(ctx, {
          spec, reqText, frames: frames.map((f) => f.id), rules, context, existing, refs, recent, fromRefs, earlierTheme, inv, reading,
          earlierScreens: earlier && !earlier.skipped ? earlier.screens as ScreenT[] : [], feedback,
          fine: prev && again?.fine.length ? prev.screens.filter((x) => again!.fine.includes(x.id)) : [],
        })
        : await think(ctx, {
          stage: "design", route: "design", cls: "read-large", budgetTokens: 80000, tools: [], schema: DesignOut, maxTurns: 4,
          sections: [S.template("tpl", RULES), ...rules, ...context, S.task("Draw the screen inventory.")],
        });
      if (!r.ok) return r.outcome;
      const out = keepFine(r.output, again?.fine ?? [], prev, earlierTheme);
      const map = mapDesign(spec.requirements.map((q) => q.id), out, frames.map((f) => f.id));
      const bad = [
        ...mapFailures(map),
        ...designQuality(out, existing, refs, recent, !!earlier?.theme && JSON.stringify(earlier.theme) === JSON.stringify(out.theme), fromRefs).map((q) => failure(q.check, q.message)),
        ...(reading ? refFit(out.theme, out.screens, out.refUse, reading, existing).map((q) => failure(q.check, q.message)) : []),
        ...localeFit(out, reqText).map((q) => failure(q.check, q.message)),
        ...modeFit(out, reqText).map((q) => failure(q.check, q.message)),
      ];
      const openRisks = "risks" in r ? [...r.risks] : [];
      if (bad.length && carries(ctx, bad)) openRisks.push(...carriedLines("the design checks", bad));
      else if (bad.length) {
        // the one answer was rejected: a retry with these failures must not read it back
        (r as { forget?: () => void }).forget?.();
        return { kind: "fail", category: "other", failures: bad, signature: `design:${bad.map((f) => f.check).sort().join(",")}`, gate: true };
      }
      // the drawn demo is measured in a browser: text past the frame, cut off or on top of other text, and (with layout references)
      // a screen that does not show its reference's navigation or regions, go back for one fix round together (after that round
      // the text problems are listed on the card and the reference gaps kept on the design); no browser, no check
      const layoutRefs = reading ? out.screens.filter((sc) => sc.refs?.some((id) => reading.refs.some((r) => r.id === id && r.role === "layout"))) : [];
      const fixRound = ctx.priorFailures.some((f) => f.check === "design-layout" || f.check === "design-ref-layout");
      let refGaps: RefLayoutGap[] = [];
      if (!fixRound || layoutRefs.length) {
        const drawn = await demoLayout(ctx.state.info.estimate?.projectName ?? ctx.runId, existing && inv?.look ? { ...out, theme: inv.look.theme } : out, spec, layoutRefs.map((sc) => sc.id));
        refGaps = reading && drawn.rendered ? refLayoutGaps(layoutRefs.map((sc) => ({ id: sc.id, refs: sc.refs, title: `${sc.mock?.title ?? ""} ${sc.route}` })), reading, drawn.rendered, out.refUse) : [];
        const issues = fixRound ? [] : drawn.issues ?? [];
        if (!fixRound && (issues.length || refGaps.length)) {
          ctx.log(`design: ${issues.length} layout problem(s) and ${refGaps.length} reference layout gap(s) in the drawn demo, sent back for one fix`);
          const fixes = [...layoutFixes(issues), ...(reading ? refLayoutFixes(refGaps, reading) : [])].map((q) => failure(q.check, q.message));
          return { kind: "fail", category: "other", failures: fixes, signature: `design:${[...new Set(fixes.map((f) => f.check))].sort().join(",")}` };
        }
        if (refGaps.length) ctx.log(`design: ${refGaps.length} reference layout gap(s) left after the fix round, kept on the design`);
      }
      const artifact = {
        header: header(ctx.runId, "design", "design", "", r.model), flow: out.flow,
        screens: out.screens.map((s) => ({ id: s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states, size: s.size, frames: s.frames, ...(s.mock ? { mock: s.mock } : {}), ...(s.mockFull ? { mockFull: s.mockFull } : {}), ...(s.app ? { app: s.app } : {}), ...(s.group ? { group: s.group } : {}), ...(reading && s.refs?.length ? { refs: s.refs } : {}) })),
        ...(reading && out.refUse?.length ? { refUse: out.refUse } : {}), ...(refGaps.length ? { refLayout: refGaps } : {}), ...(restyle ? { restyle: true } : {}),
        ...(out.apps?.length ? { apps: out.apps } : {}), ...(out.switcher ? { switcher: out.switcher } : {}), ...(out.locale ? { locale: out.locale } : {}),
        ...(prev ? { revision: sentBack.length, rework: [...(prev.rework ?? []), ...(again ? [again.round] : [])] } : {}),
        mapping: { unmappedReqs: [], orphanScreens: [] }, noScreen: out.noScreen, ...(existing ? { themeSource: "repo" as const, ...(inv?.look ? { theme: inv.look.theme } : {}) } : { themeSource: "new" as const, ...(out.theme ? { theme: withFamilies(out.theme, reading, out.refUse) } : {}) }),
      };
      return { kind: "done", outputs: { design: ctx.ledger.putJson(artifact) }, data: { screens: artifact.screens.length, states: artifact.screens.reduce((n, s) => n + Math.max(1, s.states.length), 0), ...(openRisks.length ? { openRisks } : {}) } };
    },
  };
}

export const designStep: StepDef = makeDesignStep();

/**
 * The design note of a small UI fix: one small model call, no demo, no pictures. Undefined when the note says a page has to be
 * made (that needs the full design); its links to the requirements are checked like a full design's.
 */
async function designNote(ctx: StepContext, spec: Spec, inv: DesignInventory): Promise<{ note: Record<string, unknown> & { screens: unknown[] }; model?: string; risks: string[] } | { outcome: StepOutcome } | undefined> {
  const r = await think(ctx, {
    stage: "design", route: "design", cls: "read-small", budgetTokens: 12000, tools: [], schema: DesignNoteOut, maxTurns: 2,
    sections: [
      S.template("note-rules", NOTE_RULES),
      S.artifact("requirements", "spec", spec.requirements.map((q) => ({ id: q.id, ears: q.ears }))),
      S.artifact("existing", "existing-ui", inventoryBrief(inv)),
      S.task("Write the design note."),
    ],
  });
  if (!r.ok) return { outcome: r.outcome };
  const out = r.output;
  if (out.screens.some((s) => s.size === "new")) { ctx.log("design: the note needs a new page, so the full design is drawn"); return undefined; }
  const map = mapDesign(spec.requirements.map((q) => q.id), { ...out, screens: out.screens.map((s) => ({ ...s, states: [], frames: [] })) } as never);
  const bad = [
    ...map.unknown.map((x) => failure("design-unknown-req", `${x} is not a requirement in the spec`)),
    ...map.unmappedReqs.map((x) => failure("design-unmapped", `${x} is on no screen and not listed under noScreen`)),
    ...map.orphanScreens.map((x) => failure("design-orphan", `screen ${x} serves no requirement`)),
    ...map.duplicateIds.map((x) => failure("design-duplicate-id", `two screens share the id ${x}`)),
    ...map.duplicateRoutes.map((x) => failure("design-duplicate-route", `two screens share the route ${x}`)),
  ];
  const noteRisks = bad.length && carries(ctx, bad) ? carriedLines("the design note's checks", bad) : [];
  if (bad.length && !noteRisks.length) return { outcome: { kind: "fail", category: "other", failures: bad, signature: `design-note:${bad.map((f) => f.check).sort().join(",")}`, gate: true } };
  return {
    note: {
      note: true, flow: out.flow, screens: out.screens.map((s) => ({ id: s.id, route: s.route, file: s.file, reqs: s.reqs, size: s.size, change: s.change })),
      mapping: { unmappedReqs: [], orphanScreens: [] }, noScreen: out.noScreen, themeSource: "repo" as const, ...(inv.look ? { theme: inv.look.theme } : {}),
    },
    ...(r.model ? { model: r.model } : {}), risks: noteRisks,
  };
}
