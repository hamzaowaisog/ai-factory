// A new product's sign-up and log-in. A request rarely asks for them, and the spec's round trip flags what was not asked for,
// so past greenfield runs built none: one built JWT checks on every operation and no way to get a token, and every call
// failed. A new product gets a minimal sign-up and log-in as the factory's own answer (Q-AUTH) unless its request already
// asks for both; the spec must then have them (accountsProblems).
import type { Answer } from "./settle.js";

/** The factory's answer the drafters cite for sign-up and log-in, and the round trip counts as decided. */
export const ACCOUNTS_ID = "Q-AUTH";

// "register(s)" alone: "registered vehicle" or "vehicle registration" is no sign-up (run e220)
const SIGN_UP = /\b(sign[\s-]?ups?|signs up|signing up|registers?|create (an |a |their |your )?account)\b/i;
const LOG_IN = /\b(log[\s-]?ins?|logs in|logging in|sign[\s-]?ins?|signs in|signing in)\b/i;
// a log-in through Google or another provider needs that provider's keys before anyone can log in (run e220): email and password instead
const SOCIAL = /\b(google|microsoft|facebook|apple|github|oauth|sso|single sign-on|social (log|sign))/i;

/** Text asks for both sign-up and log-in. */
export const hasSignUpAndLogIn = (text: string): boolean => SIGN_UP.test(text) && LOG_IN.test(text);

/**
 * The factory's answer for a new product's accounts, or undefined when the request already asks for sign-up and log-in
 * and names no Google or other provider to log in with.
 */
export function accountsDefault(request: string): Answer | undefined {
  if (hasSignUpAndLogIn(request) && !SOCIAL.test(request)) return undefined;
  return {
    id: ACCOUNTS_ID, by: "factory",
    question: "Does the product need user accounts (sign-up and log-in)?",
    answer: "Yes, a minimal one for the demo: a person signs up with a name, an email and a password, logs in with that email and password, and logs out. "
      + "Every page and API call that shows or changes a person's data needs them logged in. No password reset, email confirmation or social sign-in: "
      + "where the request asks for a log-in through Google, Microsoft or another provider, this email and password sign-up and log-in replaces it.",
  };
}

/** Where a spec given the accounts answer lacks sign-up or log-in; nothing when it has both. */
export function accountsProblems(spec: { requirements: { ears: string; acceptance: { given: string; when: string; then: string }[] }[]; outOfScope?: string[] }): string[] {
  const text = [
    ...spec.requirements.map((r) => [r.ears, ...r.acceptance.map((a) => `${a.given} ${a.when} ${a.then}`)].join(" ")),
    // the web side of a full-stack product: a requirement the API run proves is listed out of scope citing API-SIDE
    ...(spec.outOfScope ?? []).filter((o) => o.includes("API-SIDE")),
  ].join("\n");
  const missing = [...(SIGN_UP.test(text) ? [] : ["sign-up"]), ...(LOG_IN.test(text) ? [] : ["log-in"])];
  return missing.length
    ? [`The product has user accounts (${ACCOUNTS_ID}) but the spec has no ${missing.join(" and no ")}: add a requirement for each (sign up with name, email and password; log in with email and password; log out), citing ${ACCOUNTS_ID} in sources.`]
    : [];
}
