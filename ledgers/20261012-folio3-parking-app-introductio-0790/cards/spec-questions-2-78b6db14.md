# Questions about the spec (round 2 of at most 2)

Run 20261012-folio3-parking-app-introductio-0790. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-14** May the weekly report email contain employee-identifying utilization data for named recipients who are not Parking Administrators?
  A. Send employee-identifying reports only to configured recipients who are Parking Administrators; omit other listed addresses from delivery.   ← recommended: This preserves Q-11’s access restriction while limiting changes to report delivery.
  B. Allow every configured recipient to receive the employee-identifying report as an explicit exception to Q-11.
  C. Send the full report to Parking Administrators and a redacted, non-identifying version to other configured recipients.
  (settles: REQ-21 emails employee-identifying unused-parking/utilization data to every named recipient, but Q-11 limits viewing employee utilization records to Parking Administrators and the spec does not require report recipients to hold that role.)

**Q-15** What validation must succeed before a Google OAuth callback can create an authenticated session?
  A. Validate the Google-issued ID token signature, issuer, and audience; verify OAuth state; and confirm the account is an active Folio3 employee.   ← recommended: This adds the callback and identity checks needed to prevent forged callbacks without prescribing a broader authentication redesign.
  B. Use Google's server-side OpenID Connect authorization-code flow, validating the token signature, issuer, audience, state, and nonce before confirming active employee status.
  C. Validate that the submitted email address belongs to the Folio3 domain, without validating the callback token or OAuth state.
  (settles: REQ-1 accepts a callback containing an employee identity without requiring validation of a Google-issued token, issuer/audience, or OAuth state, so the acceptance criteria do not prevent forged callbacks from creating authenticated sessions.)

**Q-16** What replay defense should authenticated LPR entrance-verification requests use?
  A. Require a unique authenticated request ID or nonce and reject any ID or nonce already accepted.   ← recommended: A one-time request identifier directly prevents reuse of an already accepted authenticated request.
  B. Require a signed request timestamp within a short validity window, without tracking previously accepted requests.
  C. Require both a short validity window and a unique authenticated request ID or nonce, rejecting reused IDs.
  (settles: REQ-16 authenticates trusted equipment but specifies no freshness or replay defense, allowing a captured authenticated request for a currently authorized plate to be replayed to activate the entrance indicator.)

Answer with letters or your own words:
  factory answer 20261012-folio3-parking-app-introductio-0790 78b6db14 Q-14=A Q-15=A Q-16=A
  (use quotes for words: Q-14="only for trade customers")

Card hash: 78b6db14