# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## Development

Use pnpm 11.28.5, as pinned in `package.json`.

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
pnpm lint
pnpm preview
```

Commit `pnpm-lock.yaml` when dependencies change.

## TypeScript and linting

All application code uses TypeScript: React components are `.tsx`, and game logic,
audio, and Vite configuration are `.ts`. `tsconfig.json` enables strict checking,
including unused declarations and unchecked indexed access.

`pnpm typecheck` checks the source and Vite configuration without emitting files.
`pnpm lint` runs the type checker followed by Oxlint with zero warnings allowed.
`pnpm build` also type-checks before creating the production bundle.

No test runner is configured.

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, commit messages, and the
Git workflow. Project instructions for coding agents are in [AGENTS.md](AGENTS.md).
