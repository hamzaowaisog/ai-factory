// A throwaway PostgreSQL server in a container: the lab's test database, and the coding session's own (claude-agent.ts).
// Its superuser gets a random password nobody sees; the code under test logs in as a role that may create databases.
import { randomBytes } from "node:crypto";
import type { ContainerRuntime } from "./runtime.js";

/** What Postgres needs back after --cap-drop=ALL to start. */
export const PG_CAPS = ["CHOWN", "SETUID", "SETGID", "FOWNER", "DAC_OVERRIDE"];
export const PG_ADMIN = "factory_admin";

export function pgAdminEnv(): Record<string, string> {
  return { POSTGRES_USER: PG_ADMIN, POSTGRES_PASSWORD: randomBytes(16).toString("hex"), POSTGRES_DB: "postgres" };
}

export async function waitForPg(rt: ContainerRuntime, id: string, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await rt.exec(id, ["pg_isready", "-h", "127.0.0.1"])).code === 0) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Postgres didn't become ready in 60 s");
}

/** The login the code under test uses (CREATEDB, never superuser) and its empty database. */
export async function createTestLogin(rt: ContainerRuntime, id: string, v: { DB_USER: string; DB_PASSWORD: string; DB_NAME: string }): Promise<void> {
  const ident = v.DB_USER.replace(/"/g, "");
  const pw = v.DB_PASSWORD.replace(/'/g, "''");
  // separate -c flags: CREATE DATABASE can't run inside the single transaction one -c makes
  const r = await rt.exec(id, ["psql", "-v", "ON_ERROR_STOP=1", "-U", PG_ADMIN, "-d", "postgres",
    "-c", `CREATE ROLE "${ident}" LOGIN CREATEDB NOSUPERUSER PASSWORD '${pw}'`,
    "-c", `CREATE DATABASE "${v.DB_NAME.replace(/"/g, "")}" OWNER "${ident}"`]);
  if (r.code !== 0) throw new Error(`Couldn't create the test database login: ${r.stderr.split(v.DB_PASSWORD).join("«SECRET»").slice(0, 300)}`);
}
