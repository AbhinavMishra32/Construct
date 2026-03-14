# Construct

Construct is a local-first Electron IDE for guided, project-based software learning.

The repository currently includes:

- Phase 0 scaffold for the Electron app, runner, and shared package workspace.
- Phase 1 shared schemas and a canonical sample workflow runtime project.
- A stored implementation ledger at `docs/implementation-ledger.md`.

## Workspace

- `app`: Electron main, preload, and React renderer.
- `runner`: local runner service and sample test harness.
- `pkg/shared`: shared schemas and types.
- `playbooks/sample`: canonical sample project and initial playbook metadata.

## Commands

```bash
pnpm install
pnpm dev
pnpm verify:phase1
```

