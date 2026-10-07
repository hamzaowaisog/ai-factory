# Dry runs on real containers, at $0

These scripts run whole factory runs with **scripted model answers and scripted coding agents**, on **real
containers**: the real git worktrees, the real Node and .NET labs, the real gates, the real design-fidelity check.
They cost nothing. They prove the plumbing; they do not prove that a real model writes good output.

Run them from the repo root. They need Docker, and the fidelity check needs a browser that can start
(`sudo npx playwright install-deps chromium`).

| Script | What it runs | Time |
|---|---|---|
| `npx tsx dryrun/one-run-greenfield.ts --intent dryrun/intent-example.md` | One greenfield run: empty repo to a delivered Next.js branch, two screens. Add `--no-fidelity` to skip the browser check. | about 12 min |
| `npx tsx dryrun/one-run-greenfield.ts --intent dryrun/intent-example.md --kill-at-implement` | The same, killed as the second task starts. It prints the command that resumes it (`--resume <home> <run>`). Wait a minute first: the run lock goes stale after 60 s. | about 10 min |
| `npx tsx dryrun/fullstack.ts dryrun/intent-example.md` | `factory fullstack` end to end: both repos, the web run, the contract hand-over, the API run, then the compose files. The API's second task first names a field wrongly, so the contract gate must fail once and pass on the retry. | about 17 min |

Each run gets a fresh factory home under `~/.factory/tmp/greenfield-dryrun/`; your real home is not touched. The
last lines of the output give the steps, the cards, the contract gate's results and the folder.

After `fullstack.ts`, start both apps and check them:
```
cd <RUNDIR printed at the end> && docker compose up -d
curl http://localhost:5080/api/appointments/today        # rows from the SQLite file
curl -X POST -H 'content-type: application/json' -d '{"email":"a@b.co"}' http://localhost:5080/api/sign-in
curl -o /dev/null -w '%{http_code}\n' http://localhost:3000/login
docker compose down
```

Files:
- `web-script.ts`, `api-script.ts`: the scripted answers and agents for each side. They match on words in each
  step's system prompt, so a reworded prompt shows up here as "unscripted system prompt".
- `intent-example.md`: a two-screen stand-in request.
- `tsconfig.json`: `npx tsc --noEmit -p dryrun/tsconfig.json` typechecks the scripts.

When a step's output shape changes (as review's did when it started requiring a verdict per criterion), update the
scripted answer here and in `src/selftest/script.ts`.
