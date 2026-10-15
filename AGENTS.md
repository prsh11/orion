# AGENTS.md

## Project

Gamified gym & life tracker. Single-page React app — no backend, no API. All state persists to `localStorage`.

## Commands

Use pnpm (version pinned in `package.json`) for dependency management and scripts.
Commit `pnpm-lock.yaml` when dependencies change; do not create npm or Yarn lockfiles.

```bash
pnpm install     # install dependencies
pnpm dev         # dev server
pnpm typecheck   # strict TypeScript checking, no emit
pnpm build       # typecheck + production build
pnpm lint        # typecheck + oxlint, zero warnings (not eslint)
pnpm preview     # preview production build
```

No test runner is configured.

## Git workflow

- The default branch is `master`. Create a branch before starting new work; do not commit new features directly to `master`.
- New features must use `feature/<name>`, with a short lowercase kebab-case name, such as `feature/workout-history`.
- Other work uses `fix/<name>`, `docs/<name>`, `refactor/<name>`, or `chore/<name>`.
- Use Conventional Commits: `<type>(<optional-scope>): <description>`. Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`.
- Write a short imperative description, with no trailing period; aim for a subject under 72 characters. Example: `feat(workouts): add workout history`.
- Keep each commit focused on one change. Review the staged diff and run `git diff --cached --check` before committing. Do not include unrelated edits.
- Run `pnpm lint` and `pnpm build` before merging code changes. Commit dependency updates together with `pnpm-lock.yaml`.
- Keep secrets, local configuration, dependencies, and generated output out of Git. Never discard another contributor's work or rewrite shared history without explicit authorization.
- Merge feature branches through reviewed pull requests when a remote is configured; prefer squash merges with a Conventional Commit title. Delete merged branches after review.
- See `CONTRIBUTING.md` for commands and examples.

## Architecture

- **State**: Single `useReducer` + React Context in `src/store.tsx`. All game logic (XP, levels, streaks, achievements, quests) lives in the reducer. Components dispatch actions only.
- **Context**: `src/gameContext.ts` owns the typed context and `useGame` hook.
- **Persistence**: `src/save.ts` validates saved data and restores quest functions.
- **Game data**: `src/gameData.ts` — level thresholds, achievement definitions, quest templates, workout types. Pure data + check functions.
- **Audio**: `src/audio.ts` — Web Audio API synthesized SFX (no audio files). All sounds are oscillator/noise-based. Respects browser autoplay policy (fails silently until user interaction).
- **Components**: `src/components/` — one file per panel. Functional components with hooks only.
- **Styling**: Plain CSS with CSS custom properties in `src/index.css` (theme variables) and `src/App.css` (component styles). No CSS framework, no CSS modules, no Tailwind.

## Conventions

- TypeScript only: `.tsx` for React components, `.ts` for logic and config.
- Keep strict TypeScript checks passing; type reducer actions, context values, component props, and game data. Do not use `any` or TypeScript suppression comments.
- Validate persisted JSON as `unknown` in `src/save.ts`; restore quest check functions from templates when loading.
- All game state flows through the reducer — do not add `useState` for game data in components.
- Achievement/quest check functions receive the full state object and return boolean.
- Daily reset happens automatically on load when `lifeStatsDate` doesn't match today.
- Streak increments when `lastActiveDate` is yesterday; resets to 1 otherwise.
