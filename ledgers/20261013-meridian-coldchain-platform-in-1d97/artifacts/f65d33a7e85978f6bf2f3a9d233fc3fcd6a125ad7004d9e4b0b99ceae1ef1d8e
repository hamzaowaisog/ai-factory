# Questions about the spec (round 2 of at most 2)

Run 20261013-meridian-coldchain-platform-in-1d97. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-12** For a stock collection request whose filter names a warehouse outside the caller’s scope, what should the API return?
  A. Return 403 Forbidden.
  B. Return 200 OK with an empty list, applying the caller’s scope to the results.   ← recommended: This is the smallest resolution consistent with scoped collection calls returning filtered lists.
  (settles: AC-9.1 says a stock request filtered to an out-of-scope warehouse returns 403, but AC-1.2 says scoped collection calls return a list limited to the caller's scope and the supplied filters, which implies 200 with an empty or filtered list.)

**Q-13** Should authorization include a separate role-to-operation permission table beyond the roles and scopes stated in the locked contract?
  A. Add an explicit role-to-operation table covering every contract operation.
  B. Do not add a separate role-to-operation table; enforce only the role and scope restrictions stated by the locked contract.   ← recommended: The request limits implementation to the locked contract and does not ask for a new permission matrix.
  C. For operations without an explicit contract permission, allow any authenticated caller.
  (settles: REQ-9 says callers are authorized by 'PostgreSQL account roles and scopes', but no role-to-operation permission table is given or anchored in the contract (AC-9.1 just says 'the role permitted for stock listing'), so the 403 behaviour of most operations is undefined.)

**Q-14** How should startup determine whether a database qualifies for EnsureCreated, given that existing databases must use the reviewed deployment migration?
  A. Use EnsureCreated only when the database has no tables; otherwise leave schema changes to the reviewed deployment migration.   ← recommended: This provides a concrete emptiness check while keeping existing-database changes on the already agreed migration path.
  B. Use EnsureCreated only when the database has no tables or other schema objects; otherwise leave schema changes to the reviewed deployment migration.
  C. Require an explicit deployment setting to select EnsureCreated or the reviewed migration path.
  (settles: REQ-2 uses EnsureCreated for empty databases and reviewed migrations for existing ones, but EnsureCreated writes no migrations-history table, so a database it creates cannot later take a migration; the spec also never defines 'genuinely empty' or how startup detects it, even though Program.cs currently calls EnsureCreated every time.)

Answer with letters or your own words:
  factory answer 20261013-meridian-coldchain-platform-in-1d97 40ecba1b Q-12=A Q-13=A Q-14=A
  (use quotes for words: Q-12="only for trade customers")

Card hash: 40ecba1b