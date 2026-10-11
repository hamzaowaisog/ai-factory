# Notice

`SKILL.md` and `DESIGN.md` in this folder come from [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)
(`skills/stitch-skill`, commit `84ff339`), Copyright (c) 2026 Leonxlnx, under the MIT License in `LICENSE`.

Changed in this repository: `SKILL.md` adds the "EXTENDED RULES — Motion, Dynamics & Human-Made Design" section after the
original text (everything above it is unchanged). `DESIGN.md` is unchanged.

The factory reads `SKILL.md` when it writes a Stitch design system and checks it against a pinned hash
(`TASTE_SKILL_SHA256` in `src/design/stitch-taste.ts`). Any change to this file needs a review and a new pin.
