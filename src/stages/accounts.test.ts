import { describe, expect, it } from "vitest";
import { accountsDefault, accountsProblems, ACCOUNTS_ID } from "./accounts.js";

const req = (id: string, ears: string) => ({ id, ears, acceptance: [{ given: "a visitor", when: "they act", then: "it works" }] });

describe("a new product's sign-up and log-in", () => {
  it("is the factory's answer when the request does not ask for both", () => {
    expect(accountsDefault("A portal where tenants raise maintenance requests, secured with JWT")?.id).toBe(ACCOUNTS_ID);
    expect(accountsDefault("Users log in to see their orders")?.id).toBe(ACCOUNTS_ID);
  });
  it("is left out when the request asks for both", () => {
    expect(accountsDefault("Customers sign up and log in to book a table")).toBeUndefined();
  });
  it("replaces a log-in through Google or another provider (run e220)", () => {
    expect(accountsDefault("Employees sign in with their Folio3 Google Workspace account")?.answer).toMatch(/replaces it/);
    expect(accountsDefault("Users sign up and log in with Google")?.id).toBe(ACCOUNTS_ID);
  });
  it("needs a sign-up and a log-in requirement in the spec", () => {
    expect(accountsProblems({ requirements: [req("REQ-1", "The system shall reject requests without a valid JWT.")] })[0]).toMatch(/no sign-up and no log-in/);
    // a Google sign-in and a registered vehicle are no email and password sign-up (run e220)
    expect(accountsProblems({ requirements: [req("REQ-1", "When an employee starts sign-in, the app shall authenticate with Google Workspace."), req("REQ-2", "If an employee has no registered vehicle, the app shall ask for vehicle registration.")] })[0]).toMatch(/no sign-up/);
    expect(accountsProblems({ requirements: [req("REQ-1", "When a visitor signs up with a name, email and password, the system shall create their account."), req("REQ-2", "When a person logs in with a valid email and password, the system shall return a token.")] })).toEqual([]);
    // the web side: the API's own requirement is out of scope citing API-SIDE
    expect(accountsProblems({ requirements: [req("REQ-1", "When a person logs in, the app shall show their dashboard.")], outOfScope: ["REQ-2 is the API's own behaviour (API-SIDE): When a visitor registers with an email and password, the system shall store the account."] })).toEqual([]);
  });
});
