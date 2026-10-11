# Approval: Return 404 Not Found when an order doesn't exist

Run 20261006-return-404-not-found-c9cf · risk **low** · bugfix · size S · cost so far $0.00

## Your request (word for word)
> Return 404 Not Found when an order doesn't exist, instead of crashing with a 500.


## Requirements
- **REQ-1** (MODIFIED) When an order that does not exist is requested, the Shop API shall respond with 404 Not Found.
  - AC-1.1 [api] Given no order with id 999; when GET /orders/999 is called; then the response status is 404

Not changing: other endpoints

## Files the plan will touch (1)
- Shop.Api/Program.cs

## Will also affect (found by code search, not in the plan)
- Shop.Tests/OrdersTests.cs (tests): test /orders/{id:int}

## Plan
Options: O-1 (chosen): TryGetValue in the handler | O-2: exception middleware mapping KeyNotFound to 404
Decision: Check the dictionary in the handler; a global exception mapping isn't asked for.
- TASK-1 Return 404 for a missing order → REQ-1; must pass AC-1.1

## Critic findings (0)
_No OpenAI key: critic ran on claude-opus-5-5 (same family as the implementer)_

Round trip: the spec restated back matches your request (nothing dropped, nothing added).

## Decide
  factory approve 20261006-return-404-not-found-c9cf <hash> --note "your risk note"
  factory reject  20261006-return-404-not-found-c9cf <hash> --reason "why"

Card hash: 7e04bd21