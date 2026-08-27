# Contributing

## Merging

`main` holds one commit per logical change. Branch history is working material;
it is not published.

| Rule | Rationale |
|---|---|
| Squash merge only. Merge commits and rebase merges are disabled on the remote | A branch's twelve intermediate commits describe how the work was found, not what changed. `main` should read as a list of changes, so `git log` and `git bisect` stay useful |
| The pull request title becomes the commit subject. Its body stays on the pull request | The title is already written for a reader who was not present, and reusing it removes the second, worse description a merge commit would otherwise generate. The body does not travel with it: § Commits keeps commit bodies empty, so the pull request remains the place the narrative lives |
| Delete the branch once merged | The commit is on `main`; the branch is a duplicate that ages badly |
| Never force-push a branch someone else has pulled, and never rewrite `main` | Rewriting published history invalidates every clone. History was rewritten once, before the first push, and that is the only safe time |

## Commits

| Rule | Rationale |
|---|---|
| One logical change per pull request | A pull request that changes the parser and the container image cannot be reviewed as one thing, or reverted as one thing |
| Work-in-progress, fixup and review-response commits belong on a branch and never on `main` | Squash discards them, so write them freely. This is the point of squashing: cheap commits while working, one clean commit when landing |
| Subject is `type(scope): description` — lowercase description, imperative mood, no trailing period, under 72 characters | `feat(web): add the film picker interface`, not `Added picker stuff.` The type says what kind of change it is without opening the diff, and it is machine-readable, so changelog and release tooling stay available later |
| Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert` | A closed set. A change that fits none of them is usually two changes |
| The body is empty | A commit body is invisible from `git log --oneline`, from the file, and from the review, so it is the wrong home for anything a reader needs later. Architectural reasoning belongs in `docs/decisions/DR-<n>-<slug>.md`, measured facts in `docs/DESIGN.md`, and the narrative of a change in the pull request that carries it |
| The commits before this policy do not follow it, and never will | `main` is published, and § Merging forbids rewriting it. The boundary is a fact about the history, not a defect to repair |
| The body is empty | A commit body is invisible from `git log --oneline`. See § Gate |
| A commit that only fixes the previous commit should be amended into it before pushing | Two commits that describe one change are one commit that has not been finished |

## Gate

`bun run check` runs the typecheck, the linter, a production bundle of the
interface and the tests. It is wired in three places, and
none of them are optional:

| Where | Scope |
|---|---|
| `.githooks/pre-commit` | The full gate, before every commit |
| `.githooks/commit-msg` | The message being written |
| `.github/workflows/ci.yml` | The full gate, plus the gate over every commit message in history |

Activate the hooks once per clone:

```bash
git config core.hooksPath .githooks
```

Bun does not typecheck on its own — `bun test` passes with type errors present,
so `tsc --noEmit` is the only thing standing between the annotations and
reality. Do not skip the gate with `--no-verify`.

`bun run bundle` is in the gate because the interface has no build step of its
own: `Bun.serve` bundles `index.html` at boot, so a broken import or an
unparseable stylesheet is a runtime failure on the first request rather than a
compile error. The gate builds it once so that failure happens here instead.

## Tests

| Rule | Rationale |
|---|---|
| A behaviour change arrives with the test that would have caught its absence | The suite runs in under a second; there is no cost argument for skipping it |
| Only `tests/live.test.ts` may touch the network, and it skips unless `LIVE=1` | A broken outbound path must never be able to fail the suite |
| Fixtures under `tests/fixtures/` are captured, never hand-written, except where a test pins exact encoding behaviour | Hand-written HTML agrees with the parser by construction and proves nothing about the live site |
