# Contributing

## Merging

- Squash merge only. Merge commits and rebase merges are disabled on the remote.
- The pull request title becomes the commit subject; its body stays on the pull request.
- Delete the branch once merged.
- Never force-push a branch someone else has pulled, and never rewrite `main`.

## Commits

- One logical change per pull request.
- Work-in-progress, fixup, and review-response commits belong on a branch, never on `main` (squash discards them, so commit freely while working).
- Subject: `type(scope): description`, with a lowercase description, imperative mood, no trailing period, under 72 characters.
- Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`. A change that fits none of them is usually two changes.
- The body is empty. Architectural reasoning goes in `docs/decisions/DR-<n>-<slug>.md`, measured facts in `docs/DESIGN.md`, the narrative in the pull request.
- A commit that only fixes the previous one gets amended into it before pushing.

## Gate

`bun run check` runs typecheck, lint, a production bundle, and tests. Enforced by `.githooks/pre-commit` and by `.github/workflows/ci.yml` on every push and pull request. Don't skip it with `--no-verify`.

Activate hooks once per clone:

```bash
git config core.hooksPath .githooks
```

(`tsc --noEmit` is needed because `bun test` passes with type errors present. `bun run bundle` is needed because `Bun.serve` bundles `index.html` at boot, so a broken import would otherwise surface as a runtime failure instead of a build error.)

## Release

`ci.yml`'s `check` job gates a `release` job that runs only on pushes to `main`. There is no separate deploy step.

| Stage | What happens |
|---|---|
| `check` | Full gate; gates `release` via `needs:` |
| `release` | Builds the container, pushes `ghcr.io/molchalih/zufallsfilm:main` + `:sha-<sha>`, keyless-cosign-signs the digest |
| deployment | Resolves `:main` to a digest, cosign-verifies it, rolls the container (~35 min) |

Pushing to `main` ships to production; the deployment refuses any image it cannot verify.

**The workflow filename and branch are load-bearing.** The deployment pins the signing identity to:

```
^https://github\.com/molchalih/zufallsfilm/\.github/workflows/ci\.yml@refs/heads/main$
```

Renaming `.github/workflows/ci.yml`, moving `release` to another file, or changing the default branch breaks deploys **silently**: builds and signs keep working, verification just stops matching. Any such change must land with the matching change on the deployment side. `release`'s last step re-runs this regexp against the digest it just signed, so drift fails the build instead of going unnoticed.

The signature is on the digest, never the `:main` tag. Pull requests cancel superseded runs; pushes to `main` don't (a cancellation between push and sign would publish an unsigned digest). `:main` is guarded with `enable={{is_default_branch}}`. Actions are pinned by commit SHA, not tag (mutable tags are a supply-chain risk, and not every action publishes one, and `cosign-installer` does not).

## Tests

- A behaviour change arrives with the test that would have caught its absence.
- Only `tests/live.test.ts` may touch the network, and it skips unless `LIVE=1`.
- Fixtures under `tests/fixtures/` are hand-authored, never captured from a live response (a captured page carries real member data; a fixture holds only what the parser reads).
