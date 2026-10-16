# AGENTS.md

## Project

Orion is a private, account-based life-tracking RPG. React + TypeScript + Vite,
plain CSS, Supabase Auth, and PostgreSQL. The server owns tracking records,
progression, quest rewards, and boss settlement. Browser storage holds sessions,
appearance preferences, unfinished drafts, and idempotent pending requests only.

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

`pnpm test` runs Node tests through tsx, including the production migration on
PGlite. `pnpm test:e2e` runs Playwright with mocked Supabase HTTP responses.
Set `ORION_TEST_DATABASE_URL` to an isolated migrated PostgreSQL database to run
the multi-connection concurrency test. Never point tests at production.

## Git workflow

- The default branch is `master`. Create a branch before starting new work; do not commit new features directly to `master`.
- New features must use `feature/<name>`, with a short lowercase kebab-case name, such as `feature/workout-history`.
- Other work uses `fix/<name>`, `docs/<name>`, `refactor/<name>`, or `chore/<name>`.
- Use Conventional Commits: `<type>(<optional-scope>): <description>`. Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`.
- Write a short imperative description, with no trailing period; aim for a subject under 72 characters. Example: `feat(workouts): add workout history`.
- Keep each commit focused on one change. Review the staged diff and run `git diff --cached --check` before committing. Do not include unrelated edits.
- Run `pnpm lint` and `pnpm build` before merging code changes. Commit dependency updates together with `pnpm-lock.yaml`.
- Keep secrets, local configuration, dependencies, and generated output out of Git. Never discard another contributor's work or rewrite shared history without explicit authorization.
- Leave completed work local by default. Push branches or create pull requests only when the user explicitly asks; completing a feature does not authorize either action.
- When the user requests a pull request, merge feature branches through reviewed pull requests when a remote is configured; prefer squash merges with a Conventional Commit title. Delete merged branches after review.
- See `CONTRIBUTING.md` for commands and examples.

## Architecture

- **State**: `src/orion/store.tsx` owns the rendering reducer: confirmed snapshots, loading, errors, pending commands, and notification queue. Components call authenticated commands and never award XP locally.
- **Context**: `src/orion/context.ts` owns the typed context and `useOrion` hook.
- **Backend**: `supabase/migrations/` owns schema, RLS, transactional commands, reward events, one-time quest instances and objectives, and cron settlement. Internal helpers live in the unexposed `private` schema. Always set a safe search path on database functions.
- **Client**: `src/orion/client.ts` uses the official Supabase client for authenticated RPCs. Never put service-role credentials in the browser.
- **Calculations**: `src/orion/logic.ts` contains display arithmetic, units, pace, and analytics. PostgreSQL decides actual awards and outcomes.
- **Legacy compatibility**: `src/save.ts`, `src/gameData.ts`, and `src/types.ts` validate old browser saves and restore their template functions for import only. Preserve the `fitquest-save-v1` key until and after import; never replay historical rewards.
- **Audio and rewards**: `src/audio.ts` synthesizes Web Audio SFX with a shared volume bus and cancellable voices (no audio files). `src/orion/feedback.ts` derives typed presentations from confirmed snapshots; the provider owns their queue, and `RewardExperience.tsx` coordinates visuals/audio. Initial loads and retries never replay rewards; background refreshes use silent recaps. Respect opt-in, reduced motion, and account boundaries.
- **Components**: `src/orion/` — account, tracking, quests, character, and settings screens. Functional components with hooks only.
- **Artwork**: `src/orion/GameIcon.tsx` owns the pixel equipment/utility icons and rank medals; `src/orion/RpgArt.tsx` selects local WebP scenes from `src/assets/rpg/`. Keep artwork decorative, preserve accessible labels, and record generated-art prompts beside the assets.
- **Styling**: Plain CSS with CSS custom properties in `src/index.css` (theme variables) and `src/App.css` (component styles). No CSS framework, no CSS modules, no Tailwind.

## Conventions

- TypeScript only: `.tsx` for React components, `.ts` for logic and config.
- Keep strict TypeScript checks passing; type reducer actions, context values, component props, and game data. Do not use `any` or TypeScript suppression comments.
- Validate persisted JSON as `unknown` in `src/save.ts`; restore quest check functions from templates when loading.
- Confirmed game state flows through the rendering reducer. Component `useState` is for drafts and UI controls only.
- Every mutation uses a unique command ID. Persist and retry uncertain outcomes with that ID. PostgreSQL rejects reuse with a different payload; deterministic rejections roll back and unlock editing.
- Serialize every player mutation and settlement on the profile row. Reward-source keys are unique. Keep clients read-only under RLS; grant execution only on authenticated entry points.
- Store canonical kg/metres and UTC timestamps. Calendar day/week/month boundaries follow the profile timezone; weeks start Monday. Existing quest instances keep their UTC boundaries.
- Boss deadlines are exclusive. Both occurrence and recording must be inside the accepted interval. Settlement runs before reads/writes and every minute through cron. New quests never recur: all objectives must finish in their fixed accepted interval; expiry and abandonment grant no reward or penalty. Completed outcomes remain final. Todos apply late penalties only on completion: deduct 25% of difficulty XP (rounded up), grant no attribute point, and deduct 1 selected attribute point when present. Existing one-off quests retain their accepted reward rules.
- Keep local drafts separate per account and unit preference. No unconfirmed rewards, offline mutation queue, public leaderboard, or fabricated historical workout sets.
- Run `pnpm lint`, `pnpm build`, `pnpm test`, and relevant browser tests before requesting review. See README.md for deployment and live-account verification.
