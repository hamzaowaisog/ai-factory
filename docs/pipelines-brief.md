# AI Factory: the Design and Estimates pipelines (team brief)

*As built on 2026-10-03, branch `Hamza/Designs-Pipeline`.*

Both pipelines run from the `factory` CLI, and the same flows are available in the web screens (`factory ui`).

More detail:
- [estimates-overview.md](estimates-overview.md): one-page overview
- [estimates-design.md](estimates-design.md): full estimates design
- [design-step.md](design-step.md): the design step
- [estimate-consistency.md](estimate-consistency.md): consistency and self-tuning

## 1. Design pipeline: from requirements to an approved design

```bash
factory design start "<requirements>" [--project <p>] [--ref <image | link | Figma | PDF>]
```

1. **Clarify.** The requirements are refined into a clean spec with no open questions.
2. **References.** The factory reads layout, colours, fonts and corners from any images, links, Figma files or PDFs you attach.
3. **Draw.** The factory produces a mock, a clickable demo and the look (theme tokens). These cover every screen and its states, such as empty, loading and error.
4. **Approve.** A person approves the design with `factory approve` or on the run page.
   - The approved design becomes a versioned design package.
   - Approval creates v1, and each change request adds v2, v3 and so on.
   - A version is never changed once written.
5. **Export.** `factory design export <run>` writes:
   - PNGs and a PDF design book
   - the clickable demo
   - tokens (W3C, CSS, Tailwind) and JSON
   - `figma.json` for our own Figma plugin (no paid Figma seat needed)
6. **Into code.** A build turns the approved design into a Next.js or Vite shadcn app, or uses the repo's own components.
   - Pages, the theme and sample data are generated.
   - The agents write only each screen's data and behaviour.
   - A fidelity check compares the built app with the design.

Useful commands: `design show`, `design open`, `design list`, `design scaffold`, `design fidelity`.

## 2. Estimates pipeline: hours, API cost and elapsed time

```bash
factory estimate --file requirements.docx [--project <p>] [--no-repo] [--from-design <run>]
```

1. **Input.** Refined requirements, from a prompt, a Word or Markdown file, Jira or Figma frames.
   - For an existing product, the factory also reads the repo.
   - For a new product, use `--no-repo`.
2. **Design first.** UI work needs an approved design, which becomes the sizing baseline. `--from-design` reuses an approved design run.
   - `--resize <run>` sizes an earlier estimate run again: its requirements, answers, spec, approved design and settings are reused, and only breakdown, sizing, approval and the workbooks run. Use it to see what a change to sizing or the workbooks does to an estimate, with no new clarify or design. Add `--fresh` to ask the model for a new breakdown even when the same one is stored.
3. **Breakdown.** Requirements become features and tasks. Each task cites its requirement.
4. **Sizing.**
   - Every task gets a kind from the task catalogue.
   - Three independent estimators pick a size step, and the median is used. Tasks they disagree on are flagged.
   - Code, not the model, reads the hours from the catalogue and does all the arithmetic.
   - Similar approved past tasks are used as references.
5. **Cost and time.** Both come from our own measured runs. Until we have enough runs, they are labelled cold-start and shown with wide ranges.
6. **Gates.** A lead approves at E7, once all the gates below pass.

   | Gate | Checks |
   |---|---|
   | E1 Readiness | Spec is clean, no open questions |
   | E1b Design baseline | Mock and clickable demo approved (UI work) |
   | E1c Design coverage | Every task's screen is in the design, and every screen has a task |
   | E2 / E3 Traceability | Requirement to task and task to requirement; extras go to "Suggested, not included" |
   | E2c Task kind | Every task has a catalogue kind on a track that kind fits |
   | E4 Forgotten work | CI/CD, environments, monitoring and so on, each marked in, or out with a reason |
   | E5 Consistency | Similar tasks get similar hours, with no unexplained outlier |
   | E6 Workbook lint | Code recomputes every total and link |
   | E7 Approval | A lead approves (or the factory, in an opt-in hands-off run), tied to the estimate's hash |

7. **Output.** Two Excel workbooks on the Folio3 estimation template, one for the team and one for the client. The client copy comes with the design book PDF.
8. **A person reviews by default.** A lead answers the questions and approves the estimate. `--hands-off` opts out: open questions become labelled assumptions and the factory approves, but no build can follow a hands-off estimate.

## 3. From an approved estimate to a build (existing repos)

```bash
factory start --project <p> --from-estimate <run>
```

The build runs under gates B1–B7:

| Gate | Checks |
|---|---|
| B1 Scope lock | Every plan task maps to an approved estimate task |
| B2 Change request | A new or changed requirement creates estimate v2 with a diff |
| B3 Size cap | The finished change is no bigger than approved |
| B4 Unrequested behaviour | The diff traces to requirements |
| B5 Budget burn | Warns at 80% of the approved maximum and stops at 100% |
| B6 Screens planned | Every approved screen is delivered by a plan task |
| B7 Screen scope | The task that builds an approved screen may touch that screen's file |

## 4. Self-calibration

After every estimate and build, the factory measures its numbers against what actually happened. In the background, it proposes a new version of the task catalogue; nothing is sized from it until a person promotes it with `factory calibrate --apply`.

- **Small, bounded changes.** A value that already fits is left alone. Any change is at most ±20% per version, and hard floors and ceilings apply.
- **Version pinning.** A run keeps the catalogue version it was sized with.
- **Commands.** `factory calibrate --tune` shows what the tuning would change and keeps it as the proposal, `--apply` promotes exactly that proposal, and `--history` lists the versions and why each one changed.

## Status

- **Existing products (brownfield):** estimate and build are wired end to end.
- **New products (greenfield):** estimating works. The greenfield team owns building.
  - The plug points they asked for are in place: the estimate link, the breakdown shape, starter components and the stack.
  - These are not yet joined to their build mode.
- **Not yet verified with the real model:** everything is tested with a simulated model only.
  - Next: the first live runs, which need `ANTHROPIC_API_KEY`.
  - Next: a test of the Figma plugin in real Figma.
- **Needs a person:** design approval, estimate approval (unless hands-off), and promoting catalogue tuning.
