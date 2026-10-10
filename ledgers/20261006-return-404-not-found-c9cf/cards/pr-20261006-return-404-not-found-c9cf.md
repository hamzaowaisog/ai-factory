# factory: When an order that does not exist is requested, the Shop API

## What was asked
> Return 404 Not Found when an order doesn't exist, instead of crashing with a 500.

## Requirements → tests
- **REQ-1** When an order that does not exist is requested, the Shop API shall respond with 404 Not Found.
  - AC-1.1 (HTTP test + probe): `shop.tests::Shop.Tests.MissingOrderTests.AC_1_1_Returns404ForMissingOrder`

## Tasks
- TASK-1 Return 404 for a missing order (REQ-1)

## Checks the factory ran itself
- 4 tests in a sealed container; 4 passed; no new failures vs the base branch
- Acceptance tests were written first, failed on the old code twice, then locked
- ⚠ Single model family: tests written by claude-sonnet-5, code by claude-sonnet-5 (both anthropic). A second-vendor coding runner isn't built yet.
- Review: 0 non-blocking findings (No OpenAI key: review ran on claude-opus-5-5 (same family as the implementer))
- Security review (OWASP Top 10): nothing found

Cost: $0.00 · Run: `20261006-return-404-not-found-c9cf` · Evidence manifest: `d8b6cce8ad9dc1a5751b750c076efa4f4e468df49651e0ed1f2dd4e3e0667846`