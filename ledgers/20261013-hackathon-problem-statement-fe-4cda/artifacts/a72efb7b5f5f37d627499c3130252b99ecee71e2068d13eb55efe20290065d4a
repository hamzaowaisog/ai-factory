# Questions about the spec (round 2 of at most 2)

Run 20261013-hackathon-problem-statement-fe-4cda. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-7** How should AC-5.1 provide an authenticated principal for protected list requests while keeping seeding disabled?
  A. Add a test-only account fixture, separate from demo seed data, and authenticate the protected-list requests with it.   ← recommended: This supplies the missing principal while keeping demo seeding disabled and leaving the contract's declared security requirements intact.
  B. Have the test harness inject an authenticated principal without creating an account in the database.
  C. Provide a test account and token through the test environment rather than AC-5.1.
  D. Change AC-5.2 and AC-5.3 to verify the protected lists reject unauthenticated requests instead of expecting list responses.
  (settles: AC-5.2 and AC-5.3 expect list responses from a clean database with seeding disabled, but without the account fixture explicitly supplied in AC-5.1 there is no principal to satisfy REQ-1's authentication requirements for protected lists.)

Answer with letters or your own words:
  factory answer 20261013-hackathon-problem-statement-fe-4cda 48c2d827 Q-7=A
  (use quotes for words: Q-7="only for trade customers")

Card hash: 48c2d827