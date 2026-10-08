// Which database a new product's API keeps its data in: SQLite (a file beside the app) or PostgreSQL (its own server).
// A choice a person made wins: the `--database` option, or a database the request names. Otherwise the factory proposes one
// from the request's own words by the fixed list below, with the reason in a line. No model reads the request here, so the
// same request always gets the same answer, and a person can switch it until the API run starts.
export type DatabaseKind = "sqlite" | "postgres";
export const DATABASE_KINDS: readonly DatabaseKind[] = ["sqlite", "postgres"];
export const DATABASE_NAME: Record<DatabaseKind, string> = { sqlite: "SQLite", postgres: "PostgreSQL" };

export interface DatabaseChoice {
  kind: DatabaseKind;
  /** why, in one line a person reads on the product page */
  reason: string;
  /** who decided: a person's option, the request's own words, or the factory's proposal from the list below */
  by: "option" | "request" | "proposal";
}

interface Signal { what: string; words: RegExp }

/** What makes a product need a database server. The first group that matches is the reason given. */
const POSTGRES_SIGNALS: Signal[] = [
  { what: "several people change the same records at once", words: /\b(bookings?|reservations?|orders?|checkout|payments?|inventory|stock levels?|concurren\w+|simultaneous\w*|at the same time|multi-?user|multi-?tenant)\b/gi },
  { what: "it is to be hosted where a local file does not last or is not shared", words: /\b(production|go(es|ing)? live|deploy\w*|hosted|hosting|cloud|aws|azure|gcp|google cloud|kubernetes|k8s|heroku|render\.com|fly\.io|load balanc\w+|replicas?|high availability|scal(e|es|ing|able)|thousands of users|millions?)\b/gi },
  { what: "it keeps money, audit or reporting data", words: /\b(invoices?|billing|ledgers?|accounting|financial|refunds?|audit\w*|reporting|analytics|dashboards? over time|large (data|volumes?)|history of every)\b/gi },
];
/** What says a file is enough, even when a word above appears. Hosting still wins over these. */
const SQLITE_SIGNALS = /\b(demo|prototype|proof of concept|poc|sample|mock-?up|throw-?away|local database|runs? locally|on (my|one|a single) (machine|laptop|computer)|single[- ]user|just for me)\b/gi;
const OTHER_DATABASES = /\b(mysql|mariadb|sql server|mssql|oracle|mongo(db)?|dynamodb|cosmos ?db|firestore|cockroach(db)?)\b/i;

const found = (text: string, re: RegExp): string[] => [...new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase()))];
const quote = (words: string[]): string => words.slice(0, 3).map((w) => `"${w}"`).join(", ");

/** The database for a product: the option when given, else the one the request names, else the proposal from its words. */
export function chooseDatabase(request: string, option?: DatabaseKind): DatabaseChoice {
  if (option) return { kind: option, reason: "Picked when the product was started.", by: "option" };
  const postgres = /\bpostgres(ql)?\b/i.test(request), sqlite = /\bsqlite\b/i.test(request);
  if (postgres !== sqlite) return { kind: postgres ? "postgres" : "sqlite", reason: `The request names ${DATABASE_NAME[postgres ? "postgres" : "sqlite"]}.`, by: "request" };
  const other = request.match(OTHER_DATABASES)?.[0];
  const also = other ? ` The request names ${other}, which the factory does not set up for a new product: it builds on SQLite or PostgreSQL.` : "";
  const hits = POSTGRES_SIGNALS.map((s) => ({ what: s.what, words: found(request, s.words) }));
  const local = found(request, SQLITE_SIGNALS);
  const hosted = hits[1]!.words.length > 0;
  if (local.length && !hosted) return { kind: "sqlite", reason: `The request reads as something small or local (${quote(local)}), so a database file beside the app is enough.${also}`, by: "proposal" };
  const hit = hits.find((h) => h.words.length);
  if (hit) return { kind: "postgres", reason: `The request says ${hit.what} (${quote(hit.words)}), which a database file handles badly.${also}`, by: "proposal" };
  return { kind: "sqlite", reason: `Nothing in the request asks for a database server (many people writing at once, hosting, money or audit data), so a database file beside the app is enough.${also}`, by: "proposal" };
}

/** `--database` as typed: sqlite, postgres (or postgresql), or auto for the factory's proposal. Throws in plain words. */
export function databaseOption(typed: string | undefined): DatabaseKind | undefined {
  const v = typed?.trim().toLowerCase();
  if (!v || v === "auto") return undefined;
  if (v === "sqlite") return "sqlite";
  if (v === "postgres" || v === "postgresql") return "postgres";
  throw new Error(`"${typed}" is not a database the factory sets up for a new product: use sqlite, postgres, or auto (the factory proposes one from the request).`);
}
