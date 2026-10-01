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
/** The block shapes; `big` lifts the size limits for the full-data state (more rows, points and items). */
const blockSchema = (big: boolean) => z.discriminatedUnion("type", [
  z.object({ type: z.literal("stats"), items: z.array(z.object({ label: Str(40), value: Str(24), delta: Str(24).optional() })).min(1).max(big ? 6 : 4) }),
  z.object({ type: z.literal("filters"), search: Str(40).optional(), chips: z.array(Str(30)).max(6).default([]) }),
  z.object({ type: z.literal("table"), columns: z.array(Str(30)).min(1).max(6), rows: z.array(z.array(Str(60))).min(1).max(big ? 14 : 6), statusColumn: z.number().int().min(0).optional() }),
  z.object({ type: z.literal("form"), fields: z.array(z.object({ label: Str(40), kind: z.enum(["text", "select", "date", "textarea", "toggle"]).default("text"), placeholder: Str(60).optional(), value: Str(80).optional(), options: z.array(Str(40)).max(8).optional() })).min(1).max(6), submit: Str(30).default("Save") }),
  z.object({ type: z.literal("chart"), kind: z.enum(["bar", "line"]).default("bar"), title: Str(60), points: z.array(z.object({ label: Str(16), value: z.number() })).min(2).max(big ? 14 : 8) }),
  z.object({ type: z.literal("cards"), visual: z.boolean().optional(), items: z.array(z.object({ title: Str(50), meta: Str(80), badge: Str(24).optional() })).min(1).max(big ? 9 : 6) }),
  z.object({ type: z.literal("steps"), items: z.array(Str(30)).min(2).max(6), current: z.number().int().min(0).default(0) }),
  z.object({ type: z.literal("timeline"), items: z.array(z.object({ time: Str(24), title: Str(60), meta: Str(80).optional(), status: z.enum(["done", "now", "next"]).default("next") })).min(1).max(big ? 10 : 6) }),
  z.object({ type: z.literal("detail"), style: z.enum(["card", "pass"]).default("card"), title: Str(50).optional(), lead: z.object({ label: Str(30), value: Str(40) }).optional(), rows: z.array(z.object({ label: Str(30), value: Str(60) })).min(1).max(8) }),
  z.object({ type: z.literal("list"), items: z.array(z.object({ title: Str(60), meta: Str(80) })).min(1).max(big ? 10 : 6) }),
  z.object({ type: z.literal("actions"), buttons: z.array(Str(30)).min(1).max(4) }),
  z.object({ type: z.literal("text"), body: Str(240) }),
]);
export const MockBlock = blockSchema(false);
export const MockBlockFull = blockSchema(true);
export const ScreenMock = z.object({
  title: Str(60), subtitle: Str(120).optional(),
  blocks: z.array(MockBlock).min(1).max(6),
  /** the words a state shows: the empty page, an error, a success message, a validation message */
  copy: z.object({ emptyTitle: Str(60).optional(), emptyHint: Str(120).optional(), error: Str(140).optional(), success: Str(140).optional(), validation: Str(140).optional() }).default({}),
});
export type ScreenMock = z.infer<typeof ScreenMock>;
/** The same screen with fine-grained data: every block of the normal page, denser (more rows, points and items), plus the graphs and figures a real day of use would show. */
export const ScreenMockFull = z.object({ title: Str(60), subtitle: Str(120).optional(), blocks: z.array(MockBlockFull).min(1).max(9), copy: ScreenMock.shape.copy });
export type ScreenMockFull = z.infer<typeof ScreenMockFull>;

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
  font: z.enum(["sans", "humanist", "serif", "rounded"]).default("sans"),
  radius: z.enum(["sharp", "soft", "round"]).default("soft"),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  surface: z.enum(["flat", "soft", "glass"]).default("flat"),
  motion: z.enum(["calm", "lively"]).default("lively"),
  /** how modern the page feels: "quiet" (plain), "modern" (soft glow, hover lift, scroll reveal), "futuristic" (glow mesh, spotlight cards, gradient headings; for products whose users expect it) */
  fx: z.enum(["quiet", "modern", "futuristic"]).default("modern"),
  /** the real products this look draws on and what was taken from each: the proof the look is not invented */
  basis: z.array(z.object({ ref: Str(40), took: Str(120) })).max(5).optional(),
});
export type DesignTheme = z.infer<typeof DesignTheme>;
export type MockBlock = z.infer<typeof MockBlock>;

export const DesignBody = z.object({
  flow: z.string(),
  screens: z.array(z.object({
    id: Id, route: z.string(), file: z.string(), reqs: z.array(Id),
    states: z.array(z.string()).optional(), size: z.enum(["new", "tweak", "design-system", "reuse"]).optional(), frames: z.array(z.string()).optional(),
    mock: ScreenMock.optional(), mockFull: ScreenMockFull.optional(),
  })),
  mapping: z.object({ unmappedReqs: z.array(Id), orphanScreens: z.array(Id) }),
  noScreen: z.array(z.object({ req: Id, reason: z.string() })).optional(),
  theme: DesignTheme.optional(),
  /** "repo": the existing app's tokens and components are the look (no theme drawn); "new": the theme is the new product's */
  themeSource: z.enum(["new", "repo"]).optional(),
  /** how many rejections this design already answers, and what each round changed (in the lead's terms) */
  revision: z.number().int().optional(),
  rework: z.array(z.object({
    round: z.number().int(), mode: z.enum(["patch", "redraw", "none"]), patched: z.array(z.string()), lines: z.array(z.string()), kept: z.array(z.string()),
    notDesign: z.array(z.object({ quote: z.string(), why: z.string() })), fine: z.array(z.string()),
  })).optional(),
  figmaUrl: z.string().optional(),
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
