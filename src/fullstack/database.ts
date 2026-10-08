// Which database a new product's API keeps its data in: PostgreSQL, always. A product started before that was settled has a
// SQLite file beside its API and stays on it: nothing switches a product's database once it is set up.
export type DatabaseKind = "sqlite" | "postgres";
export const DATABASE_NAME: Record<DatabaseKind, string> = { sqlite: "SQLite", postgres: "PostgreSQL" };

export interface DatabaseChoice {
  kind: DatabaseKind;
  /** why, in one line a person reads on the product page */
  reason: string;
}

const OTHER_DATABASES = /\b(sqlite|mysql|mariadb|sql server|mssql|oracle|mongo(db)?|dynamodb|cosmos ?db|firestore|cockroach(db)?)\b/i;

/** The database of a new product, with a word on a request that asks for another one: it is not set up, and a person should know. */
export function newProductDatabase(request: string): DatabaseChoice {
  const other = request.match(OTHER_DATABASES)?.[0];
  return { kind: "postgres", reason: `Every new product's API is built on PostgreSQL.${other ? ` The request names ${other}, which the factory does not set up for a new product.` : ""}` };
}
