// Artifact schemas (contracts.md §2, §6; verify-runner §2.10).
// Model-produced artifacts are split into a "body" (what the model returns, used as its
// structured-output schema) and the stored artifact (header + body), so the model never
// writes its own header.
import { z } from "zod";
import {
  ChangeClass, Complexity, Evidence, Failure, GitSha, Id, Risk, Sha, StageName,
} from "./common.js";

export const ArtifactKind = z.enum([
  "repo-profile", "conventions", "baseline", "intent", "current-behaviour",
  "questions", "spec", "design", "impact", "plan", "approval", "acceptance-tests",
  "failures", "verification", "review", "delivery", "adr", "work-breakdown", "estimate",
  "acceptance-evidence", "evidence-manifest",
  // verify-runner §2.10
  "test-run", "build-run", "lint-run", "migration-run", "audit-run", "secret-scan", "timing",
  // raw blobs the ledger stores (diffs, logs, packs, cards)
  "blob",
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ArtifactHeader = z.object({
  kind: ArtifactKind,
  schemaVersion: z.literal(1),
  runId: z.string(),
  producedBy: z.object({
    stage: StageName,
    agent: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
  }),
  inputsHash: Sha,
  createdAt: z.string(),
});
export type ArtifactHeader = z.infer<typeof ArtifactHeader>;

const withHeader = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ header: ArtifactHeader, ...shape });

// ---------- repo profile + conventions ----------
export const Stack = z.enum(["dotnet", "node-express", "react-vite", "nextjs"]);
export const RepoProfileBody = z.object({
  packages: z.array(z.object({
    path: z.string(), stack: Stack, toolchain: z.record(z.string(), z.string()),
  })),
  commands: z.array(z.object({
    restore: z.string(), build: z.string(), test: z.string(),
    lint: z.string().optional(), format: z.string().optional(),
    source: z.enum(["ci", "stackpack", "readme"]),
  })),
  baseline: z.enum(["green", "green-with-known-failures", "red"]),
  knownFailures: z.array(z.string()),
  modules: z.array(z.object({ path: z.string(), purpose: z.string() })),
  repoMap: z.string(),
  codeIntel: z.enum(["repomap", "graphify"]),
  docs: z.array(z.object({
    path: z.string(), kind: z.string(), conformance: z.number().optional(),
    contradicted: z.array(z.string()),
  })),
  noGo: z.array(z.string()),
  refusals: z.array(z.object({ code: z.string(), reason: z.string() })).default([]),
  profileCommit: z.string(),
});
export const RepoProfile = withHeader(RepoProfileBody.shape);
export type RepoProfile = z.infer<typeof RepoProfile>;

export const Convention = z.object({
  id: Id,
  appliesTo: z.array(z.string()),
  rule: z.string(),
  exemplar: z.string(),
  check: z.object({
    tool: z.enum(["eslint", "roslyn", "grep", "depcruise", "archunit"]), ref: z.string(),
  }).optional(),
  evidence: z.object({
    matching: z.number(), total: z.number(), recentMatching: z.number(), recentTotal: z.number(),
  }),
  status: z.enum(["confirmed", "mixed", "candidate"]),
  source: z.enum(["tool-config", "mined", "human", "stackpack"]),
});
export type Convention = z.infer<typeof Convention>;
export const Conventions = withHeader({ conventions: z.array(Convention) });

// ---------- spec pipeline ----------
export const IntentBody = z.object({
  source: z.enum(["ticket", "brief", "cli"]),
  sourceRef: z.string().optional(),
  spans: z.array(z.object({ id: Id, text: z.string() })).min(1),
  changeClass: ChangeClass,
  risk: Risk,
  riskTags: z.array(z.string()),
  rigor: z.enum(["light", "full"]),
  touchesUi: z.boolean(),
});
export const Intent = withHeader(IntentBody.shape);
export type Intent = z.infer<typeof Intent>;

/** ground: claims about today's behaviour, each anchored to file lines (+ symbol). */
export const CurrentBehaviourBody = z.object({
  claims: z.array(z.object({
    id: Id,
    text: z.string(),
    spans: z.array(Id),
    anchors: z.array(Evidence.extend({ symbol: z.string().optional() })).min(1),
  })),
  notFound: z.array(z.object({ span: Id, searched: z.array(z.string()) })).default([]),
});
export const CurrentBehaviour = withHeader(CurrentBehaviourBody.shape);
export type CurrentBehaviour = z.infer<typeof CurrentBehaviour>;

export const Question = z.object({
  id: Id, category: z.string(), text: z.string(),
  options: z.array(z.string()).min(2), recommended: z.string(),
  impact: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  uncertainty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  answer: z.string().optional(), answeredBy: z.string().optional(),
});
export const Assumption = z.object({ id: Id, text: z.string(), risk: Risk, fromSpan: z.array(Id) });
export const QuestionsBody = z.object({
  questions: z.array(Question),
  assumptions: z.array(Assumption),
  conflicts: z.array(z.string()),
});
export const Questions = withHeader(QuestionsBody.shape);
export type Questions = z.infer<typeof Questions>;

export const AcceptanceCriterion = z.object({
  id: Id, given: z.string(), when: z.string(), then: z.string(),
  /** unit: a public class method called directly · api: an HTTP call · job: a job run · ui: a screen (checked by a person until browser tests exist) · manual */
  level: z.enum(["unit", "api", "job", "ui", "manual"]),
});
export const Requirement = z.object({
  id: Id,
  ears: z.string(),
  op: z.enum(["ADDED", "MODIFIED", "REMOVED"]),
  anchors: z.array(Evidence).optional(),
  sources: z.array(Id),
  acceptance: z.array(AcceptanceCriterion),
  stability: z.number().min(0).max(1).optional(),
});
export type Requirement = z.infer<typeof Requirement>;

/** What a specify draft / merge returns. */
export const SpecDraft = z.object({
  requirements: z.array(Requirement),
  nfrs: z.array(z.object({ id: Id, text: z.string(), metric: z.string() })),
  outOfScope: z.array(z.string()),
  assumptions: z.array(Id),
});
export type SpecDraft = z.infer<typeof SpecDraft>;

export const CriticFinding = z.object({
  finding: z.string(), reqId: Id.optional(),
  severity: z.enum(["critical", "high", "medium", "low"]),
});
export const Spec = withHeader({
  ...SpecDraft.shape,
  lint: z.array(z.object({ check: z.string(), passed: z.boolean(), details: z.string() })),
  critic: z.array(CriticFinding),
  roundTrip: z.object({ droppedSpans: z.array(Id), inventedCapabilities: z.array(z.string()) }),
});
export type Spec = z.infer<typeof Spec>;

/** What a screen shows, with believable sample data: drawn into the clickable demo (code, no model). Kept small on purpose. */
const Str = (n: number) => z.string().max(n);
/**
 * A button: a plain label (the first of a group is the main one), or the label with its look. variant: primary (the one main
 * action), secondary, ghost (quiet, in toolbars and rows), danger (deletes, cancels or takes something away) or link; icon: a word
 * for its picture ("download", "plus"; else chosen from the verb); iconOnly: only the picture shows, the label is its name for
 * screen readers and its tooltip; state: disabled (not possible yet) or loading (working); hint: a tooltip; menu: the button is a
 * split button, its arrow opening these other choices ("Export" with "CSV", "PDF").
 */
export const ButtonSpec = z.object({
  label: Str(30), variant: z.enum(["primary", "secondary", "ghost", "danger", "link"]).optional(), icon: Str(20).optional(), iconOnly: z.boolean().optional(),
  state: z.enum(["disabled", "loading"]).optional(), hint: Str(80).optional(), menu: z.array(Str(30)).min(1).max(6).optional(),
});
export type ButtonSpec = z.infer<typeof ButtonSpec>;
export const Button = z.union([Str(30), ButtonSpec]);
export type Button = z.infer<typeof Button>;
/** A button's label, however it was given. */
export const btnText = (b: Button): string => (typeof b === "string" ? b : b.label);
/** Every label a button can be pressed by: its own and its split menu's. */
export const btnLabels = (b: Button): string[] => (typeof b === "string" ? [b] : [b.label, ...(b.menu ?? [])]);

/**
 * One field of a form. Beyond text, select, date, textarea and toggle: radio (one of the options, shown at once), checkbox (several
 * of the options; the value lists the ticked ones, comma-separated), number, currency (the value or placeholder carries the code or
 * sign, "PKR 25,000"), otp (a one-time code, its length from the value or 6), phone (country code then number, "+92 300 1234567"),
 * search (a select you type into, for long option lists), slider (a value between the first and last option, "0" and "50 km"),
 * card (card number, expiry and security code; placeholders only, never a real number), password (hidden, with show and hide),
 * email, time, daterange (a start and an end date; the value "12 Mar 2026 - 18 Mar 2026"), multiselect (several of a long list,
 * picked ones as chips; the value lists them comma-separated), combobox (type to filter a long list, one picked) and consent
 * (one "I agree" box; the label is the sentence).
 * required: marked and checked; help: a line under the field; disabled or readOnly: shown but not editable; error: its own
 * message in the validation state ("Enter a valid IBAN"); hint: a tooltip beside the label.
 */
export const FormField = z.object({
  label: Str(80),
  kind: z.enum(["text", "select", "date", "textarea", "toggle", "radio", "checkbox", "number", "currency", "otp", "phone", "search", "slider", "card", "password", "email", "time", "daterange", "multiselect", "combobox", "consent"]).default("text"),
  placeholder: Str(60).optional(), value: Str(80).optional(), options: z.array(Str(40)).max(12).optional(),
  required: z.boolean().optional(), help: Str(100).optional(), disabled: z.boolean().optional(), readOnly: z.boolean().optional(), error: Str(100).optional(), hint: Str(80).optional(),
});
export type FormField = z.infer<typeof FormField>;
/** The block shapes; `big` lifts the size limits for the full-data state (more rows, points and items). */
const blockSchema = (big: boolean) => z.discriminatedUnion("type", [
  z.object({ type: z.literal("stats"), items: z.array(z.object({ label: Str(40), value: Str(24), delta: Str(24).optional() })).min(1).max(big ? 6 : 4) }),
  /** chips narrow what is shown; segments switch how it is shown (List, Map; Day, Week, Month), one at a time */
  z.object({ type: z.literal("filters"), search: Str(40).optional(), chips: z.array(Str(30)).max(6).default([]), segments: z.array(Str(16)).min(2).max(4).optional() }),
  /**
   * sortBy: the column the rows are sorted by (its header shows the direction, every header sorts on click); selectable: a tick box
   * on each row; bulk: what can be done to the ticked rows at once ("Export", "Mark paid"), shown in a bar when any is ticked;
   * pages: how many pages of rows there are when the rows are one page of many (the pager works), page: the one shown
   */
  z.object({
    type: z.literal("table"), columns: z.array(Str(30)).min(1).max(6), rows: z.array(z.array(Str(60))).min(1).max(big ? 14 : 6), statusColumn: z.number().int().min(0).optional(),
    sortBy: z.number().int().min(0).optional(), sortDir: z.enum(["asc", "desc"]).default("desc"), selectable: z.boolean().optional(), bulk: z.array(Button).min(1).max(3).optional(),
    pages: z.number().int().min(1).max(999).optional(), page: z.number().int().min(1).optional(),
  }),
  z.object({ type: z.literal("form"), fields: z.array(FormField).min(1).max(big ? 8 : 6), submit: Str(30).default("Save") }),
  /**
   * kind: bar (amounts per period), line (a level over time), stacked (bars split into "series", each point's "parts" in series order),
   * donut (shares of a whole, 2 to 6 points), progress (rings, each point a percent 0-100 toward a goal, 1 to 4 points),
   * gauge (one reading against a scale: the first point is the reading, "max" the top of the scale).
   * ranges: the periods the chart can be switched between (7D, 30D, 1Y), the first one drawn
   */
  z.object({
    type: z.literal("chart"), kind: z.enum(["bar", "line", "stacked", "donut", "progress", "gauge"]).default("bar"), title: Str(60),
    points: z.array(z.object({ label: Str(16), value: z.number(), parts: z.array(z.number()).min(2).max(4).optional() })).min(1).max(big ? 14 : 8),
    series: z.array(Str(20)).min(2).max(4).optional(), max: z.number().positive().optional(), unit: Str(8).optional(), ranges: z.array(Str(12)).min(2).max(5).optional(),
  }),
  /** people: who is on it (a team, attendees, assignees), drawn as overlapping avatars, five at most then "+N" */
  z.object({ type: z.literal("cards"), visual: z.boolean().optional(), items: z.array(z.object({ title: Str(50), meta: Str(80), badge: Str(24).optional(), people: z.array(Str(40)).max(12).optional() })).min(1).max(big ? 9 : 6) }),
  /** slides seen one at a time: "promo" for offers, announcements or onboarding (wide, on the brand colour), "media" for a row of things chosen by picture */
  z.object({ type: z.literal("carousel"), style: z.enum(["promo", "media"]).default("media"), title: Str(40).optional(), items: z.array(z.object({ title: Str(50), meta: Str(80), badge: Str(24).optional(), cta: Str(24).optional() })).min(2).max(big ? 10 : 6) }),
  z.object({ type: z.literal("steps"), items: z.array(Str(30)).min(2).max(6), current: z.number().int().min(0).default(0) }),
  z.object({ type: z.literal("timeline"), items: z.array(z.object({ time: Str(24), title: Str(60), meta: Str(80).optional(), status: z.enum(["done", "now", "next"]).default("next") })).min(1).max(big ? 10 : 6) }),
  /** a record's facts; a row with "badge" shows its value as a status (Active, Overdue); people: who it belongs to or is shared with */
  z.object({ type: z.literal("detail"), style: z.enum(["card", "pass"]).default("card"), title: Str(50).optional(), lead: z.object({ label: Str(30), value: Str(40) }).optional(), rows: z.array(z.object({ label: Str(30), value: Str(60), badge: z.boolean().optional() })).min(1).max(8), people: z.array(Str(40)).max(12).optional() }),
  /** sections opened one at a time (questions and answers, policy or settings groups), the first one open */
  z.object({ type: z.literal("accordion"), title: Str(40).optional(), items: z.array(z.object({ title: Str(60), body: Str(240) })).min(2).max(big ? 10 : 8) }),
  z.object({ type: z.literal("list"), items: z.array(z.object({ title: Str(60), meta: Str(80), badge: Str(24).optional(), people: z.array(Str(40)).max(12).optional() })).min(1).max(big ? 10 : 6) }),
  // the parts of products a field is known for, drawn as that product draws them
  /**
   * a month: "startsOn" is the weekday of the 1st (0 Monday to 6 Sunday), "days" its length; "marks" put bookings or events on days,
   * "off" are days that cannot be picked; "times" are the picked day's slots ("taken" ones struck out, "time" the chosen one)
   */
  z.object({
    type: z.literal("calendar"), month: Str(20), startsOn: z.number().int().min(0).max(6), days: z.number().int().min(28).max(31), picked: z.number().int().min(1).max(31).optional(),
    marks: z.array(z.object({ day: z.number().int().min(1).max(31), label: Str(30).optional(), tone: z.enum(["ok", "warn", "bad", "info"]).default("info") })).max(big ? 24 : 12).default([]),
    off: z.array(z.number().int().min(1).max(31)).max(31).default([]), times: z.array(Str(12)).min(2).max(big ? 16 : 12).optional(), taken: z.array(Str(12)).max(12).default([]), time: Str(12).optional(),
  }),
  /** places on a drawn map, each with its line in the list beside it; route joins them in order (a delivery run, a trip) */
  z.object({ type: z.literal("map"), area: Str(40).optional(), pins: z.array(z.object({ label: Str(40), meta: Str(60).optional(), tone: z.enum(["ok", "warn", "bad", "info"]).default("info") })).min(1).max(big ? 12 : 8), route: z.boolean().optional() }),
  /** pictures: "hero" is one large with the rest as thumbnails (a listing, a product), "grid" a wall of equal tiles (an album, a portfolio) */
  z.object({ type: z.literal("gallery"), layout: z.enum(["hero", "grid"]).default("hero"), items: z.array(z.object({ caption: Str(40) })).min(2).max(big ? 16 : 10) }),
  /** a drop zone and the files already added, each done, still uploading (progress 0 to 100) or failed */
  z.object({ type: z.literal("upload"), label: Str(40), hint: Str(80).optional(), files: z.array(z.object({ name: Str(50), size: Str(12), status: z.enum(["done", "uploading", "failed"]).default("done"), progress: z.number().min(0).max(100).optional() })).max(5).default([]) }),
  /** a conversation with one person or team ("with"), the user's messages "me"; quick are suggested replies */
  z.object({ type: z.literal("chat"), with: Str(40), meta: Str(40).optional(), messages: z.array(z.object({ from: z.enum(["me", "them"]), text: Str(240), time: Str(12).optional() })).min(2).max(big ? 16 : 10), quick: z.array(Str(30)).max(4).optional(), placeholder: Str(40).optional() }),
  /** work moving through stages: a column per stage, its cards in order; cards can be dragged between columns */
  z.object({ type: z.literal("kanban"), columns: z.array(z.object({ title: Str(24), cards: z.array(z.object({ title: Str(50), meta: Str(50).optional(), badge: Str(20).optional() })).max(big ? 8 : 5) })).min(2).max(5) }),
  /** plans side by side: "periods" switch the price (Monthly, Yearly), each plan's "alt" its price in the second; one may be featured */
  z.object({
    type: z.literal("plans"), periods: z.array(Str(16)).length(2).optional(), note: Str(30).optional(),
    items: z.array(z.object({ name: Str(24), price: Str(20), alt: Str(20).optional(), per: Str(16).optional(), blurb: Str(80).optional(), features: z.array(Str(50)).min(1).max(8), cta: Str(24), featured: z.boolean().optional(), badge: Str(20).optional() })).min(2).max(4),
  }),
  /** a rating: the average out of 5, how many rated, the share at each of 5 to 1 stars ("bars", percents), and reviews */
  z.object({ type: z.literal("reviews"), score: z.number().min(0).max(5), count: Str(24), bars: z.array(z.number().min(0).max(100)).length(5).optional(), items: z.array(z.object({ name: Str(40), rating: z.number().int().min(1).max(5), text: Str(240), time: Str(24).optional(), tag: Str(30).optional() })).min(1).max(big ? 10 : 6) }),
  /** what happened for the user, newest first, in groups (Today, Earlier); unread ones stand out */
  z.object({ type: z.literal("notifications"), items: z.array(z.object({ title: Str(80), meta: Str(80).optional(), time: Str(20), unread: z.boolean().optional(), tone: z.enum(["ok", "warn", "bad", "info"]).default("info"), group: Str(20).optional() })).min(1).max(big ? 14 : 8) }),
  /**
   * search results with filters beside them: facets of options ("picked" are ticked; kind range draws a slider between the first and
   * last option), "sort" the orders offered, items the results (visual for things chosen by picture)
   */
  z.object({
    type: z.literal("results"), query: Str(40).optional(), count: Str(30), sort: z.array(Str(30)).min(2).max(4).optional(), visual: z.boolean().optional(),
    facets: z.array(z.object({ title: Str(24), kind: z.enum(["check", "range"]).default("check"), options: z.array(Str(30)).min(2).max(6), picked: z.array(Str(30)).max(6).default([]) })).min(1).max(4),
    items: z.array(z.object({ title: Str(50), meta: Str(80), badge: Str(24).optional(), price: Str(20).optional() })).min(1).max(big ? 12 : 6),
  }),
  /** things compared feature by feature: one value per item on every row ("Yes" and "No" draw as a tick and a dash) */
  z.object({ type: z.literal("compare"), items: z.array(z.object({ name: Str(30), meta: Str(30).optional(), featured: z.boolean().optional() })).min(2).max(4), rows: z.array(z.object({ label: Str(40), values: z.array(Str(30)).min(2).max(4) })).min(2).max(big ? 14 : 10), cta: Str(24).optional() }),
  /** a receipt or invoice: who from and to, its facts (date, due, method), the lines, and the totals with the amount due last */
  z.object({
    type: z.literal("receipt"), title: Str(40), status: Str(20).optional(), from: Str(80).optional(), to: Str(80).optional(), facts: z.array(z.object({ label: Str(20), value: Str(30) })).max(4).default([]),
    lines: z.array(z.object({ item: Str(60), qty: Str(10).optional(), amount: Str(20) })).min(1).max(big ? 14 : 8), totals: z.array(z.object({ label: Str(30), value: Str(20) })).min(1).max(5), note: Str(120).optional(),
  }),
  z.object({ type: z.literal("actions"), buttons: z.array(Button).min(1).max(4) }),
  /** a message inside the page (not a toast): a tone, an optional title, the text and an optional button ("Verify now") */
  z.object({ type: z.literal("alert"), tone: z.enum(["info", "ok", "warn", "bad"]).default("info"), title: Str(60).optional(), text: Str(200), action: Str(24).optional() }),
  /**
   * the controls above a list or report that are not a form: a search, dropdowns that sort or narrow it ("Sort by", "Status",
   * each with its options and the one chosen) and buttons (a split "Export" button, "Columns")
   */
  z.object({
    type: z.literal("toolbar"), search: Str(40).optional(),
    selects: z.array(z.object({ label: Str(24), options: z.array(Str(30)).min(2).max(8), value: Str(30).optional() })).max(3).default([]),
    buttons: z.array(Button).max(3).default([]),
  }),
  /** how far things have got, as bars: a profile's completeness, a quota used, a course, a goal (each a percent 0-100) */
  z.object({ type: z.literal("progress"), title: Str(40).optional(), items: z.array(z.object({ label: Str(40), value: z.number().min(0).max(100), meta: Str(30).optional() })).min(1).max(4) }),
  z.object({ type: z.literal("text"), body: Str(240) }),
]);
export const MockBlock = blockSchema(false);
export const MockBlockFull = blockSchema(true);
/**
 * A layer the page opens over itself: a dialog (modal), a side panel (drawer), a bottom sheet, a yes-or-no question (confirm) or a
 * short menu. It opens from one of the page's own buttons (`trigger`, its label; "More" for a table row's menu).
 */
export const MockOverlay = z.object({
  /** popover: a small panel beside its button (a quick filter, a date range, a share link), not a dialog */
  kind: z.enum(["modal", "drawer", "sheet", "confirm", "menu", "popover"]),
  trigger: Str(40),
  title: Str(60),
  text: Str(200).optional(),
  /** what it shows: a form, a record's facts, a short list or text (not a whole page) */
  blocks: z.array(MockBlock).max(2).default([]),
  /** a menu's entries */
  items: z.array(Str(40)).max(8).optional(),
  /** its buttons, the main one first ("Freeze card", "Keep it active") */
  actions: z.array(Button).max(2).default([]),
});
export type MockOverlay = z.infer<typeof MockOverlay>;

/** A short message that slides in after an action and goes away by itself ("Payment sent", "Card frozen"), shown as its own tab in the demo. */
export const MockToast = z.object({
  /** the exact label of the button, menu item or overlay action that shows it */
  after: Str(40),
  text: Str(80),
  tone: z.enum(["ok", "info", "bad"]).default("ok"),
  /** an Undo link, for a step that can be taken back (archive, remove from list) */
  undo: z.boolean().optional(),
});
export type MockToast = z.infer<typeof MockToast>;

/**
 * The page's words in the product's other language: each text exactly as the page shows it in English ("from") and the same text in
 * that language ("to"). The content is written in English (code reads its statuses, amounts and dates); the demo shows the translation.
 */
export const Translation = z.array(z.object({ from: Str(240), to: Str(240) })).max(160);
export type Translation = z.infer<typeof Translation>;

export const ScreenMock = z.object({
  title: Str(60), subtitle: Str(120).optional(),
  /** the record's status beside the title (Active, Overdue, Draft), on a page about one record */
  badge: Str(20).optional(),
  blocks: z.array(MockBlock).min(1).max(6),
  /** the page's own tabs (Overview, Activity, Documents), the first one open; for one record seen several ways, not for pages of their own */
  tabs: z.array(Str(24)).min(2).max(6).optional(),
  /** the trail above this page, outermost first, not including the page itself ("Accounts", "Savings ··4821"); a phone shows it as a back button */
  crumbs: z.array(Str(40)).min(1).max(4).optional(),
  /** where the page leads: clicking the button, table row (its first cell), card, list item or slide titled `from` opens screen `to` */
  links: z.array(z.object({ from: Str(60), to: Str(16) })).max(8).optional(),
  /** the dialogs, side panels, sheets, confirmations and menus the page opens: each is shown open as its own tab in the demo */
  overlays: z.array(MockOverlay).max(3).optional(),
  /** the confirmations that slide in after the page's actions: each is shown as its own tab in the demo */
  toasts: z.array(MockToast).max(3).optional(),
  /** the words a state shows: the empty page, an error, a success message, a validation message */
  copy: z.object({ emptyTitle: Str(60).optional(), emptyHint: Str(120).optional(), error: Str(140).optional(), success: Str(140).optional(), validation: Str(140).optional() }).default({}),
  /** the page's words in the design's other language (see DesignLocale); absent for an English-only product */
  tr: Translation.optional(),
});
export type ScreenMock = z.infer<typeof ScreenMock>;
/** The same screen with fine-grained data: every block of the normal page, denser (more rows, points and items), plus the graphs and figures a real day of use would show. */
export const ScreenMockFull = z.object({ title: Str(60), subtitle: Str(120).optional(), badge: ScreenMock.shape.badge, blocks: z.array(MockBlockFull).min(1).max(9), tabs: ScreenMock.shape.tabs, crumbs: ScreenMock.shape.crumbs, copy: ScreenMock.shape.copy, tr: Translation.optional() });
export type ScreenMockFull = z.infer<typeof ScreenMockFull>;

/** Who or what the app is acting for, switched from the frame (a bank's accounts, a SaaS workspace, a group's companies or branches). */
export const Switcher = z.object({
  kind: z.enum(["account", "workspace", "company", "location", "profile"]),
  current: Str(40),
  /** a second line under the current one (a plan, a role, an account number) */
  meta: Str(40).optional(),
  others: z.array(Str(40)).min(1).max(4),
});
export type Switcher = z.infer<typeof Switcher>;

export const Shell = z.enum(["auto", "sidebar", "topbar", "drawer", "tabs", "minimal"]);
/**
 * One app of the product when it has more than one (a customer phone app and an admin portal): its own device and frame, the
 * same look. Screens name the app they belong to.
 */
export const DesignApp = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/), name: Str(40),
  device: z.enum(["web", "phone"]).default("web"),
  shell: Shell.default("auto"),
  /** who uses this app */
  users: Str(80).optional(),
  switcher: Switcher.optional(),
});
export type DesignApp = z.infer<typeof DesignApp>;

/**
 * The languages and local formats of the product, from its requirements: the languages it is offered in (the first is the one it
 * opens in; a right-to-left one such as Arabic or Urdu mirrors the page), the market whose formats it uses, its money, how dates are
 * written and which digits a right-to-left language shows. Absent: English, left to right.
 */
const Lang = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/);
export const DesignLocale = z.object({
  languages: z.array(Lang).min(1).max(2),
  /** ISO 3166 country code of the market: "PK", "AE", "SA", "US" */
  region: z.string().regex(/^[A-Z]{2}$/),
  /** ISO 4217 code of the money the product shows: "PKR", "AED" */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** how the sample content writes dates as numbers: 14/03/2027 (dmy), 03/14/2027 (mdy), 2027-03-14 (ymd) */
  dates: z.enum(["dmy", "mdy", "ymd"]).default("dmy"),
  /** the digits an Arabic-script language shows: latin 0-9 (most apps) or the script's own (٠١٢ in Arabic, ۰۱۲ in Urdu and Persian) */
  digits: z.enum(["latin", "native"]).default("latin"),
  /** words of the frame that no page carries, in the other language: navigation groups, app names, the switcher's names */
  strings: Translation.optional(),
});
export type DesignLocale = z.infer<typeof DesignLocale>;

/** The look the design step picks for the product: colours, light or dark, corners, motion. Drawn by the demo (code, no model). */
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const DesignTheme = z.object({
  mood: Str(40),
  mode: z.enum(["light", "dark", "auto"]).default("light"),
  /** the product's one brand colour; an optional second colour is a sparing highlight */
  brand: Hex, accent: Hex.optional(),
  neutral: z.enum(["cool", "warm", "pure"]).default("cool"),
  /** the app bar: filled with the brand colour, or plain */
  chrome: z.enum(["brand", "plain"]).default("plain"),
  /** the body type: sans (neutral), humanist (friendly), serif (sans body, serif headings), rounded (playful), grotesk (Swiss, plain), book (a serif to read in) */
  font: z.enum(["sans", "humanist", "serif", "rounded", "grotesk", "book"]).default("sans"),
  /** the heading and figure type paired with the body: match (the body's), serif, display (high-contrast luxury serif), geometric, condensed, slab, mono */
  heading: z.enum(["match", "serif", "display", "geometric", "condensed", "slab", "mono"]).default("match"),
  /** the logo: glyph (an abstract shape on a tile), monogram (the initial on a tile), wordmark (the name alone, set in the heading type), emblem (a symbol of what the product does) */
  mark: z.enum(["glyph", "monogram", "wordmark", "emblem"]).default("glyph"),
  radius: z.enum(["sharp", "soft", "round"]).default("soft"),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  surface: z.enum(["flat", "soft", "glass"]).default("flat"),
  motion: z.enum(["calm", "lively"]).default("lively"),
  /** how modern the page feels: "quiet" (fades only), "modern" (hover lift, rise-in, drawn charts), "futuristic" (plus a dot grid, lit edges, live dots; for products whose users expect it) */
  fx: z.enum(["quiet", "modern", "futuristic"]).default("modern"),
  /** the product's frame: a sidebar app, a top-bar site with contained content, a menu button opening a drawer, a bottom tab bar (phone apps), a minimal frame (logo only, narrow column), or chosen from the pages */
  shell: Shell.default("auto"),
  /** the page header: plain on the page, or on a brand-coloured band the first block overlaps */
  hero: z.enum(["none", "band"]).default("none"),
  /** how charts are drawn: soft (muted bars, the peak in brand, a light area), bold (brand bars, a strong area), mono (grey bars, ink line, no fill) */
  charts: z.enum(["soft", "bold", "mono"]).default("soft"),
  /** the pictures on cards: drawn scenes in one light (day, golden, dusk) or mixed, or icon tiles where photos would be fake */
  imagery: z.enum(["mixed", "day", "golden", "dusk", "icons"]).default("mixed"),
  /** the product read from its requirements before any look is chosen; every choice above follows from it */
  reading: z.object({
    /** who uses it and how often */
    users: Str(140),
    /** where and when it is used */
    context: Str(140),
    device: z.enum(["web", "phone", "both"]).default("web"),
    /** the feeling the product must give (calm, urgent, playful, premium, serious, warm...) */
    tone: Str(40),
    /** the one moment that matters most, the thing the design must make effortless */
    hero: Str(140),
    traits: z.array(Str(24)).min(2).max(4),
  }).optional(),
  /** why the brand colour sits outside the field's usual colour family, from the reading; absent when it sits inside */
  departure: Str(200).optional(),
  /** the real products this look draws on and what was taken from each: the proof the look is not invented */
  basis: z.array(z.object({ ref: Str(40), took: Str(120) })).max(5).optional(),
  /** the font families of a match reference that measured them exactly (a site's CSS, a Figma file); set by code, never by the model. Shown first, the style's own faces behind them. */
  families: z.object({ body: Str(48).optional(), heading: Str(48).optional() }).optional(),
});
export type DesignTheme = z.infer<typeof DesignTheme>;
export type MockBlock = z.infer<typeof MockBlock>;

export const DesignBody = z.object({
  flow: z.string(),
  screens: z.array(z.object({
    id: Id, route: z.string(), file: z.string(), reqs: z.array(Id),
    states: z.array(z.string()).optional(), size: z.enum(["new", "tweak", "design-system", "reuse"]).optional(), frames: z.array(z.string()).optional(),
    mock: ScreenMock.optional(), mockFull: ScreenMockFull.optional(),
    /** the app it belongs to, when the product has more than one */
    app: z.string().optional(),
    /** the navigation group it is listed under in a sidebar or drawer */
    group: z.string().optional(),
    /** the design references (R-1, ...) that shaped this screen */
    refs: z.array(z.string()).optional(),
    /** a design note's words for what changes on this page (no mock is drawn) */
    change: z.string().optional(),
  })),
  /** the product's apps when it has more than one (each with its own device and frame) */
  apps: z.array(DesignApp).optional(),
  /** the switcher of a product with one app */
  switcher: Switcher.optional(),
  mapping: z.object({ unmappedReqs: z.array(Id), orphanScreens: z.array(Id) }),
  noScreen: z.array(z.object({ req: Id, reason: z.string() })).optional(),
  theme: DesignTheme.optional(),
  /** the product's languages and local formats; absent, English left to right */
  locale: DesignLocale.optional(),
  /** "repo": the existing app's tokens and components are the look (no theme drawn); "new": the theme is the new product's */
  themeSource: z.enum(["new", "repo"]).optional(),
  /** how many rejections this design already answers, and what each round changed (in the lead's terms) */
  revision: z.number().int().optional(),
  rework: z.array(z.object({
    round: z.number().int(), mode: z.enum(["patch", "redraw", "none"]), patched: z.array(z.string()), lines: z.array(z.string()), kept: z.array(z.string()),
    notDesign: z.array(z.object({ quote: z.string(), why: z.string() })), fine: z.array(z.string()),
  })).optional(),
  figmaUrl: z.string().optional(),
  /** how each design reference was used, or why it was set aside */
  refUse: z.array(z.object({ id: z.string(), use: z.enum(["used", "set-aside"]), how: z.string() })).optional(),
  /** screens that still differ from a layout reference they cite after the fix round (code-measured on the drawn demo) */
  refLayout: z.array(z.object({ screen: z.string(), ref: z.string(), nav: z.string().optional(), missing: z.array(z.string()) })).optional(),
  /** a small UI fix: a text note (each screen's "change"), no demo; it is approved with the estimate, not on a card of its own */
  note: z.boolean().optional(),
  /** the existing app is restyled to its match references (chosen on the questions card): the theme is theirs, not the repo's */
  restyle: z.boolean().optional(),
});
export const Design = withHeader(DesignBody.shape);

// ---------- planning ----------
export const ImpactBody = z.object({
  touched: z.array(z.object({
    path: z.string(), reason: z.string(), evidence: z.array(Evidence),
    edgeKind: z.enum(["extracted", "inferred"]),
  })),
  consumers: z.array(z.string()),
  missingTests: z.array(z.string()),
  nonCode: z.array(z.enum(["migration", "ci", "infra", "config"])),
  risk: Risk,
});
export const Impact = withHeader(ImpactBody.shape);
export type Impact = z.infer<typeof Impact>;

export const PlanTask = z.object({
  id: Id, title: z.string(), reqs: z.array(Id), fileScope: z.array(z.string()).min(1),
  exemplars: z.array(z.string()), conventions: z.array(Id),
  dependsOn: z.array(Id), plannedLoc: z.number().int().nonnegative(),
  newFileKind: z.boolean().optional(),
  /** The approved estimate task this plan task delivers (gate B1); set when the run follows an approved estimate. */
  estimateTaskId: z.string().regex(/^EST-\d+$/).optional(),
  /** Short instructions for the implementer (never shown to the test author). */
  approach: z.string(),
});
export type PlanTask = z.infer<typeof PlanTask>;

export const InterfaceStub = z.object({
  path: z.string(), content: z.string(), reason: z.string(),
});
export const PlanBody = z.object({
  tasks: z.array(PlanTask).min(1),
  options: z.array(z.object({
    id: Id, summary: z.string(), simplest: z.boolean(), tradeoffs: z.string(),
  })),
  chosen: Id,
  adr: z.string(),
  protectedPathsDeclared: z.array(z.string()),
  newDependencies: z.array(z.object({ name: z.string(), version: z.string(), registry: z.string() })).default([]),
  stubs: z.array(InterfaceStub).default([]),
});
export const Plan = withHeader({ ...PlanBody.shape, complexity: Complexity });
export type Plan = z.infer<typeof Plan>;

export const Approval = withHeader({
  auto: z.boolean(),
  reason: z.string(),
  card: z.object({
    coverage: z.array(z.object({ span: Id, reqs: z.array(Id) })),
    assumptions: z.array(Id), unstable: z.array(Id), criticFindings: z.number(),
    mockUrl: z.string().optional(), plannedFiles: z.array(z.string()),
    notGrounded: z.array(z.string()).default([]),
    risk: Risk,
  }).optional(),
  decision: z.enum(["approved", "rejected", "edited"]).optional(),
  by: z.string().optional(),
  edits: z.string().optional(),
});

// ---------- tests, verify, review, deliver ----------
export const FailureKind = z.enum(["assertion", "not-implemented", "exception", "timeout", "compile", "infra"]);
export type FailureKind = z.infer<typeof FailureKind>;

export const AcceptanceTests = withHeader({
  tests: z.array(z.object({
    acId: Id, file: z.string(), name: z.string(), testId: z.string(),
    failsOnBase: z.boolean(), failureKind: FailureKind.optional(),
  })),
  characterisation: z.array(z.object({
    target: z.string(), file: z.string(), testId: z.string(), passesOnBase: z.boolean(),
  })),
  lock: z.array(z.object({ file: z.string(), sha: Sha })),
  unlocks: z.array(z.object({
    acId: Id, approvedBy: z.string(),
    reason: z.enum(["requirement-change", "test-defect"]), note: z.string(),
  })),
});
export type AcceptanceTests = z.infer<typeof AcceptanceTests>;

export const Failures = withHeader({
  attempt: z.number().int().positive(),
  items: z.array(Failure).max(20),
  priorSignatures: z.array(z.string()),
});
export type Failures = z.infer<typeof Failures>;

export const ReviewFinding = z.object({
  id: Id,
  category: z.enum(["correctness", "spec-mismatch", "error-handling", "security", "reuse", "convention-intent", "unrequested-behaviour"]),
  file: z.string(), line: z.number().int().nonnegative(), text: z.string(),
  confidence: z.number().min(0).max(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  /** security findings: the OWASP Top 10 item, e.g. "A01 Broken Access Control". Optional: older reviews have none. */
  owasp: z.string().optional(),
});
export type ReviewFinding = z.infer<typeof ReviewFinding>;
export const ReviewBody = z.object({ findings: z.array(ReviewFinding) });
export const Review = withHeader(ReviewBody.shape);

export const Delivery = withHeader({
  forge: z.enum(["bitbucket", "github"]),
  prUrl: z.string(), draft: z.boolean(),
  includedTasks: z.array(Id), excludedTasks: z.array(Id),
  trace: z.array(z.object({
    req: Id, acs: z.array(Id), tests: z.array(z.string()), tasks: z.array(Id), commits: z.array(z.string()),
  })),
  costUsd: z.number(),
});

export const EvidenceManifest = withHeader({
  artifacts: z.array(z.object({ kind: ArtifactKind, path: z.string(), sha: Sha })),
  locks: z.array(z.object({ file: z.string(), sha: Sha })),
  approvals: z.array(z.object({
    gate: z.string(), artifactSha: Sha, osUser: z.string(), gitIdentity: z.string(),
    riskNote: z.string(), at: z.string(),
  })),
  gatedTreeSha: GitSha,
  waivers: z.array(z.object({ gateId: z.string(), human: z.string(), reason: z.string(), boundTo: Sha })),
  unlocks: z.array(z.object({ what: z.string(), human: z.string(), reason: z.string(), boundTo: Sha })),
  configFingerprint: Sha,
  versions: z.record(z.string(), z.string()),
});
export type EvidenceManifest = z.infer<typeof EvidenceManifest>;

/**
 * Optional: a run's clickable preview (mocks or designs), shown by `factory ui`. No stage writes it
 * yet; the estimate module will. Lives in the run's ledger dir as preview/preview.json plus files:
 * a static site (index.html + assets) and/or labelled images. Paths are relative to preview/.
 */
export const RunPreview = z.object({
  site: z.object({
    entry: z.string().default("index.html"),
    screens: z.array(z.object({ path: z.string(), title: z.string(), req: z.string().optional() })).default([]),
  }).optional(),
  images: z.array(z.object({
    file: z.string(),
    screen: z.string(),
    req: z.string().optional(),
    viewport: z.enum(["phone", "tablet", "desktop"]).default("desktop"),
    /** the same screen before the change, for a before/after slider */
    before: z.string().optional(),
  })).default([]),
});
export type RunPreview = z.infer<typeof RunPreview>;
