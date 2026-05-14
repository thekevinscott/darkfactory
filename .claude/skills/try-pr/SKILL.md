---
name: try-pr
description: Check out a GitHub PR locally, build the rust CLI in packages/rust, and print the command to run the resulting binary in one step. Use when the user wants to try, test, or run a PR's version of the darkfactory CLI. Invoke as `/try-pr <PR#> [-- <cli args>...]`.
---

# try-pr

Fetch a PR branch, build the rust CLI, and print out how to run it — in one shot.

## Usage

```
/try-pr <PR#> [-- <cli args>...]
```

Examples:
- `/try-pr 42` — checkout PR 42, build, print out how to run with no args

## Workflow

Run these steps in order. Use a TodoWrite list so the user can see progress.

### 1. Parse args

From the skill `args` string, extract:
- `PR_NUMBER`: the first token, must be a positive integer
- `CLI_ARGS`: everything after the first `--` token (may be empty)

If `PR_NUMBER` is missing or non-numeric, stop and ask the user for a PR number.

### 2. Stash uncommitted work

Before switching branches, check `git status --porcelain`. If the tree is dirty, ask the user whether to:
- stash changes (`git stash push -u -m "try-pr <PR#>"`), or
- abort

Never discard uncommitted work without explicit confirmation.

### 3. Fetch and check out the PR

Use git directly (no `gh` CLI is available):

```bash
git fetch origin "pull/<PR#>/head:pr-<PR#>"
git checkout "pr-<PR#>"
```

If the local branch `pr-<PR#>` already exists, force-update it:

```bash
git fetch origin "pull/<PR#>/head"
git checkout -B "pr-<PR#>" FETCH_HEAD
```

If the fetch fails (network error), retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s). If it still fails, surface the error to the user and stop.

### 4. Build the CLI

```bash
cargo build --manifest-path packages/rust/Cargo.toml --release
```

If the build fails, show the cargo error output to the user and stop — do not try to "fix" the PR's code.

### 5. Print out how to run the binary & remind the user how to get back

```bash
echo './packages/rust/target/release/darkfactory'
```

Also include:
- which branch they're now on (`pr-<PR#>`)
- how to return to their previous branch (`git checkout -` or the branch name you recorded in step 2)
- if a stash was created, how to restore it (`git stash pop`)

## Notes

- This skill is read-only with respect to the PR: it never pushes, comments, or modifies the PR.
- Use `--release` so repeated runs are fast after the first build; cargo caches incremental artifacts.
