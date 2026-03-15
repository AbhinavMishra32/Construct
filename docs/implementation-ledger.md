# Construct Implementation Ledger

This file tracks the implementation phases, current status, shipped scope, and verification state for Construct.

## Baseline

- Repository initialized from a single README-only commit.
- Product name locked to `Construct`.
- Workspace/tooling direction: `pnpm` + `Turborepo`.
- Future agent stack direction is fixed: `LangGraph` orchestration with provider selection controlled by the development team, not by end users in the product UI.

## Phase Status

| Phase | Name | Status | Notes |
| --- | --- | --- | --- |
| 0 | Repo & boilerplate | Implemented | Monorepo scaffold, Electron desktop shell, runner service, root scripts, and workspace configs are in place. |
| 1 | Shared schemas & canonical sample project | Implemented | Shared schemas, blueprint validation script, real workflow runtime sample project, and Jest tests are in place. |
| 2 | File manager & snapshotting | Implemented | Workspace-scoped file IO and a separate internal git snapshot store now exist in the runner, with restore coverage for edits, creations, and deletions. |
| 3 | Test runner & adapters | Implemented | Adapter-based task execution now runs targeted Jest tests in child processes with timeouts, structured task results, and a runner endpoint for blueprint step execution. |
| 4 | Editor UI basics & anchor navigation | Implemented | The Electron renderer now loads blueprint metadata, renders a Monaco editor and file tree, opens real workspace files, and jumps to `TASK:` anchors for selected steps. |
| 5 | Learning Surface & Guidance Console | Implemented | Each unit now opens in a technical brief with quick checks, then transitions into a focused execution mode with a persistent guidance console, deterministic hints, and targeted task submission. |
| 6 | Task lifecycle & telemetry | Implemented | Pre-task snapshots, persisted task attempts, learner-model updates, telemetry submission, renderer-side task lifecycle wiring, and the compact native IDE shell pass are in place. |
| 7 | Edit tracking & anti-cheat | Implemented | Typed-versus-pasted telemetry is enforced through a rewrite gate, and the learner now works inside a materialized starter workspace where internal step tests stay hidden from the explorer. |
| 8 | Live Guide orchestration & LLM integration | In progress | Real agent foundations are now live: LangGraph job orchestration, the LangChain OpenAI provider, Tavily-backed research, SSE activity streaming, prompt compaction for structured plan generation, runtime Guide responses, first-slice generated blueprint synthesis, and agent persistence for planning state, learner knowledge, active blueprint metadata, and generated blueprint records. When `DATABASE_URL` is configured, those records are stored in Neon; otherwise Construct falls back to local state files. Dynamic plan mutation after runtime struggle is still pending. |
| 9 | Architect static generator | Pending | Not started. |
| 10 | Rollback UX & snapshot management | Pending | Not started. |
| 11 | Multi-language adapters | Pending | Not started. |
| 12 | Dynamic plan mutation & persistence | Pending | Not started. |
| 13 | E2E validation | Pending | Not started. |

## Current Changeset Scope

- Replace the previously hardcoded planner path with a real agent runtime in the runner.
- Add provider-controlled OpenAI integration through the LangChain OpenAI provider with structured outputs and `gpt-5.4` as the current default planning model.
- Add Tavily-backed architecture research behind a swappable search-provider boundary.
- Add LangGraph-backed planning/runtime graphs for question generation, personalized roadmap generation, and live runtime guidance.
- Add SSE job streaming so the renderer can show what the agent is doing while it researches and plans.
- Add detailed runner-side agent logging so the server logs mirror job lifecycle, stage events, research activity, model invocations, and completion or failure summaries.
- Add first-slice agent-generated blueprint synthesis so planning now produces a canonical project directory, masked learner files, hidden tests, and step docs/checks that the app can load directly.
- Replace the fixed runtime sample as the always-active workspace by letting the runner resolve and materialize the latest generated blueprint on demand.
- Remove the silent startup fallback to the fixed sample blueprint so the desktop app opens in planning mode until an agent-generated blueprint exists.
- Persist a user knowledge base derived from prior planning sessions and feed it back into future question generation and roadmap synthesis.
- Add an agent persistence boundary so planning sessions, learner knowledge, active generated-project selection, and generated blueprint records are stored as user data.
- Use Neon as the remote backing store for that user data when `DATABASE_URL` is configured, while keeping the runnable local project workspace on disk.
- Restore the saved planning goal from persisted state into the renderer instead of always falling back to the canned compiler example.
- Replace static “Ask guide” behavior with a real runtime Guide request that analyzes the current anchored code, constraints, and latest task result.

## Implemented So Far

- Root workspace config: [`/Users/abhinavmishra/solin/socrates/package.json`](/Users/abhinavmishra/solin/socrates/package.json), [`/Users/abhinavmishra/solin/socrates/pnpm-workspace.yaml`](/Users/abhinavmishra/solin/socrates/pnpm-workspace.yaml), [`/Users/abhinavmishra/solin/socrates/turbo.json`](/Users/abhinavmishra/solin/socrates/turbo.json), [`/Users/abhinavmishra/solin/socrates/tsconfig.base.json`](/Users/abhinavmishra/solin/socrates/tsconfig.base.json).
- Desktop shell: Electron main/preload plus React renderer under [`/Users/abhinavmishra/solin/socrates/app`](/Users/abhinavmishra/solin/socrates/app).
- Runner service: HTTP health endpoint, blueprint harness, workspace file manager, and snapshot service under [`/Users/abhinavmishra/solin/socrates/runner`](/Users/abhinavmishra/solin/socrates/runner).
- Runner service: HTTP health endpoint, blueprint metadata endpoint, workspace file APIs, task execution endpoint, and snapshot service under [`/Users/abhinavmishra/solin/socrates/runner`](/Users/abhinavmishra/solin/socrates/runner).
- Shared contracts: Zod-backed schemas in [`/Users/abhinavmishra/solin/socrates/pkg/shared/src/schemas.ts`](/Users/abhinavmishra/solin/socrates/pkg/shared/src/schemas.ts).
- Canonical sample project: real workflow runtime source and Jest tests in [`/Users/abhinavmishra/solin/socrates/blueprints/workflow-runtime`](/Users/abhinavmishra/solin/socrates/blueprints/workflow-runtime).
- Blueprint validation tooling: [`/Users/abhinavmishra/solin/socrates/scripts/validate-blueprint.ts`](/Users/abhinavmishra/solin/socrates/scripts/validate-blueprint.ts).
- Workspace file management: [`/Users/abhinavmishra/solin/socrates/runner/src/fileManager.ts`](/Users/abhinavmishra/solin/socrates/runner/src/fileManager.ts).
- Internal snapshots: [`/Users/abhinavmishra/solin/socrates/runner/src/snapshots.ts`](/Users/abhinavmishra/solin/socrates/runner/src/snapshots.ts).
- Phase 2 tests: [`/Users/abhinavmishra/solin/socrates/runner/src/fileManager.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/fileManager.test.ts) and [`/Users/abhinavmishra/solin/socrates/runner/src/snapshots.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/snapshots.test.ts).
- Targeted task execution: [`/Users/abhinavmishra/solin/socrates/runner/src/testRunner.ts`](/Users/abhinavmishra/solin/socrates/runner/src/testRunner.ts).
- Phase 3 verification fixtures: [`/Users/abhinavmishra/solin/socrates/blueprints/workflow-runtime/test-fixtures/jest-failure`](/Users/abhinavmishra/solin/socrates/blueprints/workflow-runtime/test-fixtures/jest-failure) and [`/Users/abhinavmishra/solin/socrates/blueprints/workflow-runtime/test-fixtures/jest-timeout`](/Users/abhinavmishra/solin/socrates/blueprints/workflow-runtime/test-fixtures/jest-timeout).
- Phase 3 runner tests: [`/Users/abhinavmishra/solin/socrates/runner/src/testRunner.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/testRunner.test.ts).
- App shell: [`/Users/abhinavmishra/solin/socrates/app/src/renderer/App.tsx`](/Users/abhinavmishra/solin/socrates/app/src/renderer/App.tsx).
- Renderer integration helpers: [`/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/api.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/api.ts), [`/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/tree.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/tree.ts), and [`/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/anchors.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/anchors.ts).
- Monaco setup: [`/Users/abhinavmishra/solin/socrates/app/src/renderer/monaco.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/monaco.ts) and [`/Users/abhinavmishra/solin/socrates/app/vite.config.ts`](/Users/abhinavmishra/solin/socrates/app/vite.config.ts).
- Phase 5 guide helpers: [`/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/guide.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/guide.ts).
- Phase 5 app tests: [`/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/guide.test.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/guide.test.ts).
- Phase 6 runner lifecycle: [`/Users/abhinavmishra/solin/socrates/runner/src/taskLifecycle.ts`](/Users/abhinavmishra/solin/socrates/runner/src/taskLifecycle.ts) and [`/Users/abhinavmishra/solin/socrates/runner/src/taskLifecycle.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/taskLifecycle.test.ts).
- Phase 6 task endpoints: [`/Users/abhinavmishra/solin/socrates/runner/src/index.ts`](/Users/abhinavmishra/solin/socrates/runner/src/index.ts).
- Phase 6 shared lifecycle schemas: [`/Users/abhinavmishra/solin/socrates/pkg/shared/src/schemas.ts`](/Users/abhinavmishra/solin/socrates/pkg/shared/src/schemas.ts).
- Phase 6 renderer task APIs and types: [`/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/api.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/api.ts) and [`/Users/abhinavmishra/solin/socrates/app/src/renderer/types.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/types.ts).
- Phase 6 IDE shell and task experience: [`/Users/abhinavmishra/solin/socrates/app/src/renderer/App.tsx`](/Users/abhinavmishra/solin/socrates/app/src/renderer/App.tsx) and [`/Users/abhinavmishra/solin/socrates/app/src/renderer/index.css`](/Users/abhinavmishra/solin/socrates/app/src/renderer/index.css).
- Phase 7 rewrite-gate enforcement: [`/Users/abhinavmishra/solin/socrates/runner/src/taskLifecycle.ts`](/Users/abhinavmishra/solin/socrates/runner/src/taskLifecycle.ts), [`/Users/abhinavmishra/solin/socrates/runner/src/taskLifecycle.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/taskLifecycle.test.ts), and [`/Users/abhinavmishra/solin/socrates/pkg/shared/src/schemas.ts`](/Users/abhinavmishra/solin/socrates/pkg/shared/src/schemas.ts).
- Phase 7 renderer verification UI and paste blocking: [`/Users/abhinavmishra/solin/socrates/app/src/renderer/App.tsx`](/Users/abhinavmishra/solin/socrates/app/src/renderer/App.tsx), [`/Users/abhinavmishra/solin/socrates/app/src/renderer/index.css`](/Users/abhinavmishra/solin/socrates/app/src/renderer/index.css), and [`/Users/abhinavmishra/solin/socrates/app/src/renderer/types.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/types.ts).
- Phase 7 learner workspace materialization and hidden test surface: [`/Users/abhinavmishra/solin/socrates/runner/src/workspaceMaterializer.ts`](/Users/abhinavmishra/solin/socrates/runner/src/workspaceMaterializer.ts), [`/Users/abhinavmishra/solin/socrates/runner/src/index.ts`](/Users/abhinavmishra/solin/socrates/runner/src/index.ts), and [`/Users/abhinavmishra/solin/socrates/runner/src/fileManager.ts`](/Users/abhinavmishra/solin/socrates/runner/src/fileManager.ts).
- Phase 7 learner workspace regression coverage: [`/Users/abhinavmishra/solin/socrates/runner/src/workspaceMaterializer.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/workspaceMaterializer.test.ts) and [`/Users/abhinavmishra/solin/socrates/runner/src/fileManager.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/fileManager.test.ts).
- Phase 8 shared agent-planning contracts: [`/Users/abhinavmishra/solin/socrates/pkg/shared/src/agentSchemas.ts`](/Users/abhinavmishra/solin/socrates/pkg/shared/src/agentSchemas.ts) and [`/Users/abhinavmishra/solin/socrates/pkg/shared/src/index.ts`](/Users/abhinavmishra/solin/socrates/pkg/shared/src/index.ts).
- Phase 8 runner-side planner and persistence: [`/Users/abhinavmishra/solin/socrates/runner/src/agentPlanner.ts`](/Users/abhinavmishra/solin/socrates/runner/src/agentPlanner.ts) and [`/Users/abhinavmishra/solin/socrates/runner/src/index.ts`](/Users/abhinavmishra/solin/socrates/runner/src/index.ts).
- Phase 8 planner coverage: [`/Users/abhinavmishra/solin/socrates/runner/src/agentPlanner.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/agentPlanner.test.ts).
- Phase 8 planning UI integration: [`/Users/abhinavmishra/solin/socrates/app/src/renderer/App.tsx`](/Users/abhinavmishra/solin/socrates/app/src/renderer/App.tsx), [`/Users/abhinavmishra/solin/socrates/app/src/renderer/index.css`](/Users/abhinavmishra/solin/socrates/app/src/renderer/index.css), [`/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/api.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/api.ts), and [`/Users/abhinavmishra/solin/socrates/app/src/renderer/types.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/types.ts).
- Phase 8 real agent orchestration: [`/Users/abhinavmishra/solin/socrates/runner/src/agentService.ts`](/Users/abhinavmishra/solin/socrates/runner/src/agentService.ts).
- Phase 8 agent persistence layer with Neon/local backends: [`/Users/abhinavmishra/solin/socrates/runner/src/agentPersistence.ts`](/Users/abhinavmishra/solin/socrates/runner/src/agentPersistence.ts).
- Phase 8 active-blueprint selection and runner workspace switching: [`/Users/abhinavmishra/solin/socrates/runner/src/activeBlueprint.ts`](/Users/abhinavmishra/solin/socrates/runner/src/activeBlueprint.ts) and [`/Users/abhinavmishra/solin/socrates/runner/src/index.ts`](/Users/abhinavmishra/solin/socrates/runner/src/index.ts).
- Phase 8 generated blueprint regression coverage: [`/Users/abhinavmishra/solin/socrates/runner/src/agentService.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/agentService.test.ts).
- Phase 8 real agent coverage: [`/Users/abhinavmishra/solin/socrates/runner/src/agentService.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/agentService.test.ts).
- Phase 8 persistence regression coverage: [`/Users/abhinavmishra/solin/socrates/runner/src/agentPersistence.test.ts`](/Users/abhinavmishra/solin/socrates/runner/src/agentPersistence.test.ts).
- Phase 8 runner job/SSE endpoints: [`/Users/abhinavmishra/solin/socrates/runner/src/index.ts`](/Users/abhinavmishra/solin/socrates/runner/src/index.ts).
- Phase 8 shared job, knowledge-base, and runtime-guide contracts: [`/Users/abhinavmishra/solin/socrates/pkg/shared/src/agentSchemas.ts`](/Users/abhinavmishra/solin/socrates/pkg/shared/src/agentSchemas.ts).
- Phase 8 renderer streaming integration and live Guide surface: [`/Users/abhinavmishra/solin/socrates/app/src/renderer/App.tsx`](/Users/abhinavmishra/solin/socrates/app/src/renderer/App.tsx), [`/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/api.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/lib/api.ts), [`/Users/abhinavmishra/solin/socrates/app/src/renderer/types.ts`](/Users/abhinavmishra/solin/socrates/app/src/renderer/types.ts), and [`/Users/abhinavmishra/solin/socrates/app/src/renderer/index.css`](/Users/abhinavmishra/solin/socrates/app/src/renderer/index.css).
- Phase 8 environment config for Neon-backed storage: [`/Users/abhinavmishra/solin/socrates/.env.example`](/Users/abhinavmishra/solin/socrates/.env.example).

## Verification

- Passed: static blueprint integrity check over [`/Users/abhinavmishra/solin/socrates/blueprints/workflow-runtime/project-blueprint.json`](/Users/abhinavmishra/solin/socrates/blueprints/workflow-runtime/project-blueprint.json) confirmed all 3 steps reference starter files with anchors and existing test files.
- Passed: `pnpm verify:phase1`.
- Passed: `pnpm verify:phase2`.
- Passed: `pnpm --filter @construct/shared typecheck`.
- Passed: `pnpm --filter @construct/runner typecheck`.
- Passed: `pnpm --filter @construct/runner test`.
- Passed: `pnpm --filter @construct/runner task:test`.
- Passed: `pnpm --filter @construct/shared build`.
- Passed: `pnpm --filter @construct/runner build`.
- Passed: `pnpm verify:phase3`.
- Passed: `pnpm --filter @construct/app typecheck`.
- Passed: `pnpm --filter @construct/app build`.
- Passed: `pnpm verify:phase4`.
- Passed: `pnpm --filter @construct/app test`.
- Passed: `pnpm verify:phase5`.
- Passed: `pnpm --filter @construct/app typecheck`.
- Passed: `pnpm --filter @construct/app build`.
- Passed: `pnpm --filter @construct/runner typecheck`.
- Passed: `pnpm --filter @construct/runner test`.
- Passed: `pnpm --filter @construct/runner task:test`.
- Passed: `pnpm --filter @construct/shared typecheck`.
- Passed: `pnpm --filter @construct/shared build`.
- Passed: `pnpm --filter @construct/shared typecheck`.
- Passed: `pnpm --filter @construct/shared build`.
- Passed: `pnpm --filter @construct/app typecheck`.
- Passed: `pnpm --filter @construct/app build`.
- Passed: `pnpm --filter @construct/runner typecheck`.
- Passed: `pnpm --filter @construct/runner build`.
- Passed: `export PATH="$HOME/.nvm/versions/node/v25.4.0/bin:$PATH"; pnpm --filter @construct/runner test`.
- Passed: `pnpm --filter @construct/runner build`.
- Passed: `pnpm --filter @construct/app test`.
- Passed: `pnpm --filter @construct/shared build`.
- Passed: Node `v25.4.0` verification sweep covering shared typecheck/build, runner typecheck/test/task execution/build, and app typecheck/build/test.
- Passed: LangChain OpenAI provider migration verification through `pnpm install`, `PATH="$HOME/.nvm/versions/node/v25.4.0/bin:$PATH" pnpm --filter @construct/runner typecheck`, `PATH="$HOME/.nvm/versions/node/v25.4.0/bin:$PATH" pnpm --filter @construct/runner build`, and `PATH="$HOME/.nvm/versions/node/v25.4.0/bin:$PATH" pnpm --filter @construct/runner test`.
- Passed: detailed agent logging verification through `PATH="$HOME/.nvm/versions/node/v25.4.0/bin:$PATH" pnpm --filter @construct/runner typecheck` and `PATH="$HOME/.nvm/versions/node/v25.4.0/bin:$PATH" pnpm --filter @construct/runner test`.
- Passed: generated-blueprint activation verification through `PATH="$HOME/.nvm/versions/node/v25.4.0/bin:$PATH" pnpm --filter @construct/runner typecheck`, `PATH="$HOME/.nvm/versions/node/v25.4.0/bin:$PATH" pnpm --filter @construct/runner test`, `PATH="$HOME/.nvm/versions/node/v25.4.0/bin:$PATH" pnpm --filter @construct/runner build`, `pnpm --filter @construct/app typecheck`, and `pnpm --filter @construct/app build`.
- Passed: agent persistence verification through `PATH="$HOME/.nvm/versions/node/v25.4.0/bin:$PATH" pnpm --filter @construct/runner test`, covering saved planning state, learner knowledge, active blueprint metadata, and generated blueprint record lookup through the new persistence boundary.
- Passed: learner-workspace sanity check confirmed the visible explorer surface excludes `tests/` and the materialized [`/Users/abhinavmishra/solin/socrates/blueprints/workflow-runtime/.construct/workspaces/construct.workflow-runtime.v1/src/state.ts`](/Users/abhinavmishra/solin/socrates/blueprints/workflow-runtime/.construct/workspaces/construct.workflow-runtime.v1/src/state.ts) contains the starter `throw new Error('Implement mergeState')` implementation instead of the canonical solved code.
- Note: the default shell runtime in this workspace still points at Node `v20.19.5`, so Phase 7 verification currently relies on switching to a newer local Node with `node:sqlite` support.
- Not run in this sandbox: a bind-based smoke test for the HTTP endpoint, because local listen attempts from the test process hit `EPERM`.
- Pending: `pnpm dev` smoke check for the Electron app and runner.

## Blockers

- Construct now emits a first-slice generated blueprint bundle for arbitrary goals, but the output quality still depends on a single Architect generation pass and does not yet include repair loops, schema retries for bundle content, or project execution smoke tests of the generated artifact before activation.
- The current agent fix hardens structured plan generation by compacting learner/history/research context before asking for a schema-constrained roadmap, but we still need explicit retry/fallback handling when model output does not satisfy the schema on the first attempt.
- The real agent stack requires `OPENAI_API_KEY` and `TAVILY_API_KEY` in the runner environment. Provider choice remains developer-controlled through environment configuration, not end-user UI.
- Neon-backed persistence requires `DATABASE_URL` in the runner environment. The current implementation stores planning state, learner knowledge, active blueprint metadata, and generated blueprint records in Neon when configured, but still keeps runnable project files and task-lifecycle SQLite state local on disk because execution stays local-first.

## Next Phase

Continue Phase 8 by hardening the new generated-blueprint path: add generation retries and validation repair loops, run pre-activation smoke tests on generated projects, and start persisting runtime step mutations back into the active blueprint instead of treating it as fixed after generation.
