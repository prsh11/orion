# Contributing

## Branches

Use `master` as the default branch. Start new work on a branch:

```bash
git switch master
git switch -c feature/workout-history
```

When a remote is configured, update `master` with `git pull --ff-only` before branching.
Use lowercase kebab-case names that describe the change:

| Work | Branch example |
| --- | --- |
| Feature | `feature/workout-history` |
| Bug fix | `fix/daily-reset` |
| Documentation | `docs/setup-guide` |
| Refactoring | `refactor/quest-checks` |
| Maintenance | `chore/update-dependencies` |

## Commit messages

Use Conventional Commits:

```text
<type>(<optional-scope>): <description>
```

Supported types are `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`,
`ci`, `chore`, and `revert`. Scopes identify the affected area, such as `store`,
`workouts`, `habits`, or `tooling`.

```text
feat(workouts): add workout history
fix(store): restore quest checks after reloading saves
docs: update development commands
build(tooling): migrate dependencies to pnpm
chore: initialize repository
```

Use imperative descriptions, omit the trailing period, and aim for a subject
under 72 characters. Add a body when the reason or tradeoffs need explanation.
Mark breaking changes with `!`, for example `feat(store)!: change saved workout format`,
and explain the migration in a `BREAKING CHANGE:` footer.

## Before committing

Keep commits focused and stage only the intended files. Review the staged content:

```bash
git status --short
git diff
git add src/components/WorkoutPanel.tsx
git diff --cached
git diff --cached --check
git commit -m "feat(workouts): add workout history"
```

Run `pnpm lint` and `pnpm build` for code changes before merging. The lint command
includes strict TypeScript checking and allows no Oxlint warnings. No test runner
is currently configured.

Include `pnpm-lock.yaml` with dependency changes. Do not commit `node_modules`,
`dist`, environment secrets, or local agent configuration. `.env.example` may
contain documented placeholder values only.

## Sharing and merging

When a remote is configured, push the branch and open a pull request. Describe
the resulting behavior and relevant validation. Prefer reviewed squash merges;
the pull request title should be a Conventional Commit because it becomes the
commit subject. Delete merged branches once their work is safely on `master`.

Do not force-push shared branches, amend published commits, or discard another
contributor's changes without explicit authorization. Prefer `git revert` for
undoing changes already shared with others.
