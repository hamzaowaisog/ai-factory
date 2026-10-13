# Questions about the spec (round 2 of at most 2)

Run 20261012-meridian-coldchain-platform-in-9fcb. The spec's checks found problems the requirements and earlier answers do not settle. Each question settles one or more of them; the spec is then fixed to match your answers.

**Q-14** If an offline handover is queued and the API returns a restriction because the stock went On Hold or was recalled, how should the app handle that recorded handover?
  A. Do not mark the delivery as completed; show the returned restriction and leave the affected quantity outstanding for follow-up.   ← recommended: This is the smallest behavior consistent with the requirement that affected stock cannot be handed over until quality staff decide its disposition.
  B. Record the reported handover as an exception for quality review, without treating it as an approved delivery.
  C. Allow the handover to count as completed despite the returned restriction, and show the restriction as a warning.
  (settles: Handovers recorded offline are queued and synced later, but AC-16.5 and AC-6.4 rely on a returned 'handover restriction' for stock that went On Hold or was recalled, so an offline driver can hand over held or recalled stock and nothing says what happens to that handover when it syncs.)

**Q-15** Q-10 settles that queued actions stay tied to the originating driver across sign-out and workday end, and are erased or rejected if access is refused or the account is disabled. Should any additional local protection or expiry rule apply to queued actions containing recipient names on a shared browser?
  A. Keep the existing same-driver access rule and retain queued actions until sync or API rejection/refusal; add no local encryption or expiry.   ← recommended: This preserves the existing retention decision without adding unrequested storage mechanisms or risking loss of offline work.
  B. Encrypt queued actions in browser storage and retain them until sync or API rejection/refusal.
  C. Encrypt queued actions in browser storage and delete them after 7 days if they are still unsynced.
  (settles: The ears says cached route and delivery data are cleared at sign-out, workday end or refused access, yet unsynced queued actions, which hold recipient names (PII), are kept on a possibly shared browser with no limit on how long they stay or how they are protected.)

Answer with letters or your own words:
  factory answer 20261012-meridian-coldchain-platform-in-9fcb 7570d55b Q-14=A Q-15=A
  (use quotes for words: Q-14="only for trade customers")

Card hash: 7570d55b