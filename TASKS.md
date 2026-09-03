# Simplified Visual Custom Agents implementation tasks

Plan revision: 30

`PRD.md` is authoritative. This plan modifies the current branch in place. It retains the complete graph/node/view/Mythic product while removing the transaction and generation-ownership architecture from core.

Revision 27 mechanically merged the former T001 lifecycle seam and T002 Custom Agent cutover. Repository inspection proved that exact hook ordering cannot coexist with the revision-25 staged chat path: live insertion/finalization occurs only inside a save. The seam, direct live mutation, and extension registration therefore form one indivisible cutover.

## Execution rules

- Do not reset or rebuild from `main`; use `main` only to audit and minimize core differences.
- Do not remove catalog nodes, runtime views, management, editor behavior, or Mythic scope.
- Do not preserve staged/projection/claim APIs as aliases, wrappers, deprecated paths, or optional callbacks.
- Use existing chat mutation, message event, generation, and save operations.
- Keep one writer in the working tree.
- Never stage, modify, or revert the unrelated `vite.config.ts` working-tree change.

## Milestones

| Milestone | Outcome                                                                                     | Bundles |
| --------- | ------------------------------------------------------------------------------------------- | ------- |
| M1        | Core and Custom Agents cut over atomically to minimal awaited hooks and direct live effects | T001    |
| M2        | Obsolete collateral is removed and the remaining core diff is minimal                       | T002    |
| M3        | Custom Agent activation performs one retained graph preparation and no hidden editor work   | T003    |

## T001 — Cut over to minimal lifecycle hooks and direct effects

- Status: completed
- Dependencies: none
- Integration milestone: M1
- Objective: In one coherent cutover, add the narrow lifecycle seam, restore direct live chat/generation behavior, register Custom Agents through the seam, and remove the old staged/projection/claim execution path that makes exact hook ordering impossible.
- Source requirement IDs: REQ-001–REQ-011 and the lifecycle portions of REQ-012
- In scope:
  - one single-owner lifecycle registration service with `afterUserMessage`, `beforeGeneration`, and `afterGeneration`;
  - exact hook contexts and ordering from PRD revision 26;
  - hook prompt-injection contributions, actual prompt inclusion acknowledgements, optional `assistantContent`, and graph-response acknowledgement forwarding;
  - optional hook content through the existing NEW/REGENERATE/ADD_SWIPE assistant mutation/event/save path;
  - minimal awaited `ExtensionAPI.chat.save()` backed by the existing store save path;
  - restore outgoing user and assistant generation to direct live mutation rather than cloned-chat commit/projection;
  - register/unregister Custom Agents as the lifecycle provider;
  - map retained trigger nodes to hooks and manual UI execution;
  - deterministic observer ordering inside the extension;
  - enforce at most one enabled generation-capable agent and reject multiple eligible generation flows;
  - return graph generation responses as hook `assistantContent`;
  - apply state, injection, and visible-message effects directly in execution order against the checkpoint selected at each lifecycle moment;
  - consume injection lifetimes only from acknowledgement IDs for the successful generation operation: the normal prompt build, or the union of graph LLM prompt builds in a successful graph generation flow;
  - call one normal save after successful manual actions;
  - rename staged-effect vocabulary to graph/direct effects;
  - remove production Custom Agent claim, commit, projection, rollback, restoration, and buffered-event adapters from the active path;
  - rewrite focused tests for direct-mutation semantics while retaining graph, node, editor, management, view, transfer, and Mythic behavior.
- Out of scope:
  - reducing the node catalog or view system;
  - changing graph serialization;
  - unrelated core-diff cleanup not needed for the cutover, which belongs to T002;
  - fallback to default generation after an eligible generation flow starts;
  - transaction emulation under new names.
- Acceptance criteria:
  - With no lifecycle provider, ordinary outgoing messages and generation use normal direct live mutation/events/saves.
  - Hook registration is single-owner, duplicate registration fails, unregister is identity-safe, and core imports no graph code.
  - `afterUserMessage` runs after live user insertion and before its normal save and optional generation.
  - `beforeGeneration` runs after selected target/history resolution and before prompt/provider work; its direct effects and injections are visible to normal prompt construction.
  - Core applies normal or hook-provided content through one existing NEW/REGENERATE/ADD_SWIPE path. `afterGeneration` runs after accepted live assistant finalization and normal message events, but before final generation save scheduling and `generation:finished`.
  - Normal prompt construction reports exact included injection IDs; hook-provided content uses only IDs returned with that content.
  - After-user, before-generation observer, assistant-generation, after-generation, and manual graph flows execute at the intended moments.
  - One successful generation flow supplies content without inserting the assistant message itself. No response runs normal generation; eligible-flow failure does not.
  - Conflicting enabled generation agents fail settings validation atomically; multiple eligible generation flows fail before either executes.
  - State, injection, and visible-message effects apply directly and in order. Completed effects remain after a later failure/cancellation; later nodes do not execute.
  - Only included injections are consumed after successful assistant application; excluded, failed, and unacknowledged injections remain.
  - Successful manual execution invokes the exposed existing save path exactly once.
  - Graph LLM calls retain prompt construction, budgeting failure, structured outputs, cancellation, acknowledgement forwarding, and usage attribution.
  - Full registry, runtime, editor, management, views, transfer, and representative Mythic behavior remain operational.
  - Searches find no active-path staged commit/projection/claim/restoration adapter or user-visible transaction wording.
- Verification method: Focused hook registration/order, normal/hook NEW/REGENERATE/ADD_SWIPE, direct effects, generation conflicts, manual save, prompt inclusion/consumption, graph-response acknowledgement, failure and cancellation tests; representative graph/editor/view/Mythic tests; typecheck and build; M1 integration review.
- Attempt count: 4
- Latest result: Approved. The direct lifecycle cutover removes active staged commit/projection/claim machinery, preserves one normal message path, covers schedules, cleanup, manual saves, generation modes, streaming stops, direct effects, and injection acknowledgements through real registered-hook tests. Full suite passed 48 files / 429 tests; format, lint, typecheck, build, diff-check, independent verification, and M1 integration review passed. Revision 28 intentionally uses the successful graph invocation's included-ID union instead of graph value-provenance tracking.

## T002 — Minimize the remaining core diff and verify the repository

- Status: completed
- Dependencies: T001
- Integration milestone: M2
- Objective: Delete residual obsolete machinery and restore unrelated core code so every remaining non-extension production diff is required by the narrow integration boundary.
- Source requirement IDs: REQ-002, REQ-003, REQ-005, REQ-008, REQ-012, Completion requirements
- In scope:
  - remove residual dead staged-chat commit, provisional projection, projection-owner, save-restoration, generation-claim/arbitration, and lifecycle orchestration code and tests;
  - compare every non-Custom-Agent production diff against `main`;
  - restore normal core implementations where branch changes are no longer required;
  - retain only extension registration, lifecycle hooks/call sites, hook response/injection plumbing, `chat.save()`, public chat/prompt APIs actually used by the extension, Vue Flow dependency/style wiring, and required locales/i18n;
  - remove dead types, services, fixtures, callbacks, comments, and transaction terminology;
  - run final integrated verification.
- Out of scope:
  - deleting retained graph nodes, views, management, editor features, or Mythic;
  - unrelated cleanup or redesign of code already on `main`;
  - compatibility adapters for revision 25.
- Acceptance criteria:
  - Production searches find no staged-chat commit, provisional projection, projection owner, generation claim/arbitration, rollback, or restoration machinery.
  - `chat.store.ts`, `useChatGeneration.ts`, message editing, prompt engine, usage tracker, group chat, presets, and generic extension APIs differ from `main` only for a concrete REQ-012 boundary.
  - Core imports no Custom Agent graph/runtime code.
  - Existing non-Custom-Agent generation, edits, swipes, group chat, prompt, usage, autosave, and extension behavior passes regression tests.
  - Full node registry, editor, views, import/export, and Mythic tests remain.
  - Formatting, i18n, lint, the complete behavioral suite, typecheck, build, and `git diff --check` pass.
  - Independent integration review approves ownership direction and the remaining core diff.
  - `vite.config.ts` has identical bytes before and after all commands and is absent from staged commits.
- Verification method: Main-branch diff audit, forbidden-symbol searches, focused tests, complete `npm test`, typecheck, build, and M2 integration review.
- Attempt count: 2
- Latest result: Approved. The cumulative diff retains only the narrow lifecycle/chat/prompt/registration/style/localization/Vue Flow boundaries outside Custom Agents and removes collateral API, edit, migration, event, media, utility, and test changes. The Usage Tracker generation-trace copy action remains available for debugging core and extension requests. Complete behavioral suite passed; formatting, i18n, lint, typecheck, build, diff/dependency searches, independent verification, and final M2 integration review passed.

## T003 — Remove repeated activation compilation and hidden editor initialization

- Status: completed
- Dependencies: T002
- Integration milestone: M3
- Objective: Make Custom Agent activation prepare installed graphs once, retain that compiled snapshot for runtime reads, and remove redundant catalog validation without changing the editor-opening UX.
- Source requirement IDs: REQ-001, REQ-002, REQ-010, REQ-013
- In scope:
  - one preparation result containing canonical installed settings and their compiled runtime agents;
  - reuse that result across activation, runtime registration, and initial management state;
  - O(1) runtime agent reads until a successful settings mutation supplies a replacement prepared result;
  - one strict candidate preparation before atomic persistence and runtime replacement;
  - removal of redundant activation loads, discarded plans, collection stringification, and module-evaluation catalog compilation;
  - automatic display of the selected graph editor without an extra interaction;
  - focused regression tests proving snapshot reuse and mutation replacement.
- Out of scope:
  - persistent compiled caches, workers, background initialization, compiler redesign, incremental validation, activation concurrency, visibility observers, or core extension-loader changes;
  - changing graph serialization, runtime behavior, strict import/install validation, or existing editor functionality.
- Acceptance criteria:
  - Activation parses, validates, and compiles each unchanged installed preset through one preparation path and passes that result to runtime and management.
  - Repeated lifecycle, view, and `getAgents()` reads perform no settings reload, graph serialization, validation, or compilation.
  - A successful management mutation prepares the complete candidate once before persistence and runtime replacement; invalid candidates change neither.
  - Activation does not validate or compile the Mythic template catalog.
  - The selected graph editor remains displayed automatically with complete existing behavior, and template installation remains strict and atomic.
  - Focused tests, complete behavioral suite, formatting, i18n, lint, typecheck, build, and `git diff --check` pass; `vite.config.ts` remains unchanged and unstaged.
- Attempt count: 1
- Latest result: Approved. Activation now prepares installed definitions and compiled plans once, passes the same snapshot to runtime and management, and uses O(1) runtime reads until a successfully prepared settings change replaces it. Template module evaluation no longer validates or compiles Mythic, and the editor remains automatic without new visibility machinery. Focused tests passed 3 files / 18 tests; the complete suite passed 43 files / 410 tests; formatting, i18n, lint, typecheck, build, diff checks, and independent verification passed.
- Verification method: Instrumented/unit assertions around preparation and runtime replacement, mounted activation/management test for deferred editor construction, focused host/management/editor suites, and complete repository gates.
- Attempt count: 1
- Latest result: Implementation underway.
