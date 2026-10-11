# Questions about the spec (round 2 of at most 2)

Run 20261010-co-working-space-maintenance-e182. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-8** How should AC-1.1 verify that a newly created request can be retrieved?
  A. Compare the create response with a separate get-by-ID API response.   ← recommended: This checks the already-required API operations without depending on internal storage.
  B. Inspect the database row directly after creation.
  (settles: AC-1.1 passes or fails on "the database row", which is internal storage rather than a public surface; it needs to compare the create response against a separate API get-by-ID response.)

Answer with letters or your own words:
  factory answer 20261010-co-working-space-maintenance-e182 27097915 Q-8=A
  (use quotes for words: Q-8="only for trade customers")

Card hash: 27097915