# Questions about the spec (round 2 of at most 2)

Run 20261012-meridian-coldchain-platform-in-9fcb. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-41** How should the web app complete password reset after a user opens the reset link, including when the link is invalid or expired?
  A. Open a form to set a new password; for an invalid or expired link, explain that it cannot be used and let the user request another reset email.   ← recommended: This completes the specified self-service reset with the smallest additional web flow.
  B. Open a form to set a new password; for an invalid or expired link, show a generic error and direct the user to contact support.
  C. Keep the flow limited to requesting a reset email; do not add a page for setting a new password.
  (settles: AC-1.2 covers only requesting a reset email; there is no screen or criterion for opening the reset link and setting a new password, or for an expired or invalid link, so self-service reset can't be completed or tested.)

Answer with letters or your own words:
  factory answer 20261012-meridian-coldchain-platform-in-9fcb 9b35e3f9 Q-41=A
  (use quotes for words: Q-41="only for trade customers")

Card hash: 9b35e3f9