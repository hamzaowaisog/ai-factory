# Questions about the spec (round 1 of at most 2)

Run 20261013-meridian-coldchain-platform-in-1d97. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-6** How should schema changes be applied to databases that already exist when the new persistent tables are introduced?
  A. Apply a reviewed database migration during deployment, preserving existing data; use EnsureCreated only for genuinely empty databases.   ← recommended: This supports the new persisted records without treating an existing database as if it were empty.
  B. Require a fresh, empty database for this release and do not migrate existing databases.
  C. Apply EF Core migrations automatically at application startup.
  (settles: The spec adds persistent entities but keeps startup on `EnsureCreated` (C-5), which does nothing once tables exist, and it has no migration or schema-evolution plan for existing databases despite the 'migration' risk tag.)

**Q-7** With demo seeding disabled, how should the first PostgreSQL account be made available so the API can authorize callers?
  A. Have deployment provision the initial account outside the API; do not add an API bootstrap flow.   ← recommended: This avoids adding an unrequested account-creation path while keeping demo seeding disabled.
  B. Add a one-time administrative bootstrap operation for creating the first account.
  C. Allow the demo seeder to create the initial account even when Seed:Demo is false.
  (settles: With Seed:Demo off and an empty database, no account exists, yet REQ-9 authorizes every caller from a PostgreSQL account record; the spec has no way to bootstrap the first account, and AC-5.1 assumes 'an account row provisioned by deployment' with no anchor for that process.)

**Q-8** Which staff identity provider and concrete authorization-URL and token-validation settings should the API use?
  A. Identify the organization's existing staff provider and supply its authorization URL and validation settings; do not introduce a new provider.   ← recommended: This follows the stated use of an existing provider without inventing a new identity system.
  B. Select and integrate a new staff identity provider for this API.
  C. Do not validate staff identity-provider tokens in this release.
  (settles: REQ-7 has no anchors and refers to 'the existing staff identity provider', but current-behaviour shows no identity-provider integration or configuration anywhere in the codebase.)

**Q-9** How should the test and factory runs obtain the valid nonproduction identity-provider settings required for startup?
  A. Provide valid nonproduction settings for the chosen provider through test and factory configuration.   ← recommended: This meets the startup-validation requirement while keeping test runs on nonproduction settings.
  B. Skip identity-provider configuration validation for test and factory runs.
  C. Use production identity-provider settings for the test and factory runs.
  (settles: Making startup fail on missing IdP settings will break the existing HealthTests.ApiIsUp and the factory runs, which supply no such settings today; REQ-7/REQ-8 claim these checks 'use valid nonproduction settings' without anchors and quietly require changing test and factory configuration.)

**Q-10** How much customer-authentication behavior beyond the locked contract should be specified for failed logins and password storage?
  A. Keep behavior limited to the locked contract; use standard secure password hashing for stored passwords, and do not add new lockout or one-time-code policies.   ← recommended: This avoids adding unrequested authentication policies while not storing passwords insecurely.
  B. Specify explicit responses and rules for wrong passwords, unknown emails, wrong, expired or reused codes, and locked accounts, plus password-storage requirements.
  C. Delegate customer authentication to an external identity provider instead of implementing the contract's email-and-password and one-time-code flow.
  (settles: REQ-9 has no error paths for customer authentication: wrong password, unknown email, wrong, expired or reused one-time code, and locked accounts are all missing; it also doesn't say how passwords are stored, despite the auth and pii risk tags.)

**Q-11** Which token claim should identify the PostgreSQL staff account, and what should happen if a valid token has no matching or has a disabled account?
  A. Match the token's email claim to the account email, and deny access when no matching enabled account exists.   ← recommended: Email matching is the smallest mapping consistent with the specified account-based authorization; unmatched or disabled accounts remain unauthorized.
  B. Match a stable subject identifier (`sub`) to a stored account identifier, and deny access when no matching enabled account exists.
  C. Treat every valid staff token as authorized even if no enabled PostgreSQL account matches.
  (settles: REQ-9 doesn't say how a staff IdP token maps to a PostgreSQL account record (which claim is matched), or what happens when a token is valid but has no account record, or a disabled one.)

Answer with letters or your own words:
  factory answer 20261013-meridian-coldchain-platform-in-1d97 b8e073a6 Q-6=A Q-7=A Q-8=A Q-9=A Q-10=A Q-11=A
  (use quotes for words: Q-6="only for trade customers")

Card hash: b8e073a6