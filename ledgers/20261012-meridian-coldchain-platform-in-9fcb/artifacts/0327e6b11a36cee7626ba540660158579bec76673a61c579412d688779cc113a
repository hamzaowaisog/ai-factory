# Questions about the spec (round 1 of at most 2)

Run 20261012-meridian-coldchain-platform-in-9fcb. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-9** Should this 34-requirement scope be approved as one run, split into multiple runs, or reduced?
  A. Approve all 34 requirements as one run.
  B. Split the work into about three runs without cutting requirements.   ← recommended: This preserves the requested scope while addressing the estimate that it is about three runs of work.
  C. Reject the scope and identify requirements to cut.
  (settles: L9 size: This spec has 34 requirements, about 3 runs' worth of work for a feature; approve it as one run or reject with which part to cut.)

**Q-10** If a driver's session expires while the browser is offline, may the driver continue recording loading, handover, and refusal work?
  A. Allow local recording after expiry, but require the driver to re-authenticate before queued work can sync.   ← recommended: This lets the driver continue the requested offline work while retaining the spec's re-authentication-before-sync rule.
  B. Stop new recording when the session expires; retain previously queued work for syncing after re-authentication.
  C. Allow recording and syncing without re-authentication until the browser is back online.
  (settles: REQ-12 retains work across session expiry but requires re-authentication before sync, and nothing says whether a driver whose session expires while offline can keep recording work, given that password checks need the service.)

**Q-11** Should recall blocking and conflict handling extend to offline cached recall information, or apply only once the service is reachable? The request separately requires retaining and flagging an offline handover that conflicts with a hold.
  A. Apply recall blocks from the service while online; do not add offline-cache recall blocking or a separate recall-conflict quality-case flow.   ← recommended: The request requires the driver to see a recall block when online, but does not ask for offline-cache recall handling.
  B. Also block using cached recall information offline, and flag the handover and show the returned quality-case result if it conflicts with a recall during sync.
  (settles: When a scanned box is recalled according to the service or offline cache, display “Do not deliver” and prevent its handover. | When an offline handover conflicts with a hold or recall during synchronization, retain and flag the handover and display the returned quality-case result.)

**Q-12** If the browser denies or cannot provide location, should an otherwise eligible handover still be allowed?
  A. Allow the handover and record the location as unavailable.   ← recommended: This avoids blocking an otherwise valid handover when browser location is unavailable.
  B. Require location to be available before completing the handover.
  (settles: Allow otherwise eligible handovers when browser location is denied or unavailable, and record location as unavailable.)

**Q-13** Should the offline queue include safeguards beyond the requested local work retention and automatic sending, such as account isolation, re-authentication, retry identifiers, and review of permanently rejected payloads?
  A. Keep the requested offline queue and automatic sending, without adding the extra account-isolation and rejected-payload review rules.   ← recommended: The request asks for offline work to be sent automatically, but does not specify these additional queue policies.
  B. Add the full safeguards: isolate queued work by account, require its originator to re-authenticate, preserve retry identifiers and occurrence times, retain payloads until acknowledgement, and require review before retrying permanent failures.
  (settles: While offline, retain loading, handover, and refusal work locally across session expiry or sign-out; isolate queued work to its originating account; require that user to re-authenticate before syncing; automatically send queued work when connectivity returns; preserve handover occurrence time and identifier on retries; clear payloads only after successful acknowledgement; and retain permanently rejected payloads for user review before retry. If local storage cannot retain a complete payload, show an error and do not report the work as queued.)

**Q-14** Should the web app have a formal browser support requirement for the latest two versions of Chrome, Edge, Safari, and Firefox?
  A. Add support for the latest two versions of Chrome, Edge, Safari, and Firefox.
  B. Do not add a fixed browser-version support requirement.   ← recommended: The request does not specify a browser-version matrix, so adding one would expand the acceptance scope.
  (settles: Support the latest two browser versions of Chrome, Edge, Safari, and Firefox.)

**Q-15** Should WCAG 2.1 AA conformance be added as an acceptance requirement for the main flows?
  A. Require the main web-app flows to conform to WCAG 2.1 AA.
  B. Do not add a formal WCAG 2.1 AA requirement.   ← recommended: Accessibility conformance is not specified in the request, so the recommendation avoids adding a new acceptance criterion.
  (settles: Conform the main web-app flows to WCAG 2.1 AA.)

**Q-16** Should a first-year product scale target be defined in this scope, in addition to the requested one-minute lot-trace availability?
  A. Define and include a first-year product scale target.
  B. Do not add a first-year product scale target; retain the explicitly requested lot-trace timing.   ← recommended: The request specifies trace contents and timing but does not set a product-volume target.
  (settles: Support the assumed first-year product scale and make a requested lot trace available through its screen within the requested time limit.)

Answer with letters or your own words:
  factory answer 20261012-meridian-coldchain-platform-in-9fcb 7fbe58eb Q-9=A Q-10=A Q-11=A Q-12=A Q-13=A Q-14=A Q-15=A Q-16=A
  (use quotes for words: Q-9="only for trade customers")

Card hash: 7fbe58eb