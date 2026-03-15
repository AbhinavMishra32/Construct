# Construct

Construct is a local-first Electron IDE for guided, project-based software learning.

The repository currently includes:

- Phase 0 scaffold for the Electron app, runner, and shared package workspace.
- Phase 1 shared schemas and a canonical sample workflow runtime project.
- Phase 2 workspace file management and internal snapshot services.
- Phase 3 targeted test execution with adapter-based structured task results.
- A stored implementation ledger at `docs/implementation-ledger.md`.

## Workspace

- `app`: Electron main, preload, and React renderer.
- `runner`: local runner service, workspace file manager, snapshot service, task test runner, and blueprint test harness.
- `pkg/shared`: shared schemas and types.
- `blueprints/workflow-runtime`: canonical workflow runtime and initial blueprint metadata.

## Commands

```bash
pnpm install
pnpm dev
pnpm verify:phase1
pnpm verify:phase2
pnpm verify:phase3
```
