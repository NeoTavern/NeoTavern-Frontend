# Simplified Visual Custom Agents implementation tasks

Plan revision: 32

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
| M3        | Custom Agent activation reuses one retained graph preparation                               | T003    |
| M4        | Flow navigation and metadata updates avoid repeated whole-agent derivation                  | T004    |
| M5        | Presentation-only canvas edits avoid semantic graph work                                    | T005    |

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

## T004 — Remove repeated editor derivation and metadata validation

- Status: completed
- Dependencies: T003
- Integration milestone: M4
- Objective: Make flow/scope navigation derive ports once in dependency order and prevent metadata-only synchronization from recompiling an unchanged editor graph.
- Source requirement IDs: REQ-001, REQ-009, REQ-010, REQ-013, REQ-014
- In scope:
  - replace unconditional node-count port-resolution passes with deterministic dependency ordering that remains cycle-safe for invalid drafts;
  - build and reuse direct incoming-edge/dependent indexes instead of scanning every edge for every node;
  - resolve each nested For Each body only when its owner requires it, without repeated recursive work;
  - replace large serialized per-node fingerprints with cache ownership tied directly to the current draft/scope identity;
  - reuse unchanged scope resolution when navigating away and back within the same draft;
  - initialize the editor from the already prepared valid definition without a duplicate compile;
  - synchronize name, priority, and enabled metadata without a second editor-wide validation while preserving unsaved draft content;
  - focused performance-invariant and behavior tests for dependency-derived ports, invalid cycles, flow navigation, cache invalidation, metadata updates, and normal validation after graph edits.
- Out of scope:
  - changing serialized graph/runtime semantics, relaxing strict candidate preparation, or skipping generation-owner validation;
  - workers, background validation, persistent caches, debounce delays, arbitrary timing assertions, generalized incremental compilation, or core changes.
- Acceptance criteria:
  - Selecting another flow performs no graph compilation and no node-count fixed-point passes; valid data dependencies still produce the same schemas and ports regardless of serialized node order.
  - Returning to an unchanged scope reuses its resolved result; replacing the draft invalidates that reuse and derives the changed scope correctly.
  - Invalid cyclic drafts remain diagnosable and editor rendering terminates deterministically.
  - Initial editor construction for a prepared installed agent does not compile the same definition again.
  - Name, priority, and enabled changes perform one strict collection preparation but no additional `GraphEditorStore.revalidate()`; unsaved graph edits and diagnostics are preserved.
  - Graph-affecting edits, undo, redo, reset, and apply eligibility retain strict validation and existing editor behavior.
  - Focused tests, complete behavioral suite, formatting, i18n, lint, typecheck, build, and `git diff --check` pass; `vite.config.ts` remains unchanged and unstaged.
- Verification method: Focused resolver call-count/order/schema tests and mounted navigation/metadata tests; complete behavioral suite; formatting, i18n, lint, typecheck, build, diff check; independent verification.
- Attempt count: 2
- Latest result: Approved after correction. Port derivation now uses one deterministic dependency-ordered pass with indexed edges and nested-scope reuse; cache entries include effective graph/signature/registry context while metadata-only changes remain cache hits. Prepared editor initialization avoids duplicate compilation, metadata synchronization avoids editor revalidation, and undo/redo preserve current installed metadata. Focused editor/management tests passed 2 files / 32 tests, the Custom Agents graph suite passed 16 files / 148 tests, and the complete suite passed 43 files / 418 tests. Formatting, lint, typecheck, build, diff checks, and independent reverification passed.

## T005 — Separate geometry-only editor history from semantic edits

- Status: completed
- Dependencies: T004
- Integration milestone: M5
- Objective: Make movement, resizing, and layout update only serialized node geometry while retaining chronological undo/redo and avoiding whole-agent semantic work.
- Source requirement IDs: REQ-001, REQ-010, REQ-014, REQ-015
- In scope:
  - a direct history-command representation that supports existing snapshot semantic commands and sparse geometry undo/redo in one ordered stack;
  - sparse before/after position patches for movement and both Smart Layout operations;
  - sparse before/after size patches for resizing;
  - minimal reactive draft notification while preserving graph-semantic identities and resolved-port cache hits;
  - no-op detection for unchanged geometry;
  - focused tests proving zero compile/revalidation, no whole-agent replacement, preserved serialization, cache reuse, and correct mixed geometry/semantic undo/redo ordering.
- Out of scope:
  - changing graph serialization, viewport storage, drag frequency, Vue Flow behavior, semantic validation, or apply behavior;
  - debounce, delayed persistence, workers, background work, persistent caches, timing assertions, or generalized incremental validation.
- Acceptance criteria:
  - Moving or resizing nodes and applying single/all-scope layout records one undoable command and updates the serialized geometry.
  - Geometry apply/undo/redo invokes no graph compilation, validation, or schema-buffer reconciliation and preserves graph-affecting identities used by port-resolution caching.
  - Geometry commands store only relevant position/size patches rather than complete preset snapshots or deep clones.
  - Geometry and semantic commands interleave correctly through undo and redo; a new command still clears redo history.
  - Existing graph-affecting operations retain strict validation, diagnostics, history behavior, and apply semantics.
  - Focused tests, complete behavioral suite, formatting, i18n, lint, typecheck, build, and `git diff --check` pass; `vite.config.ts` remains unchanged and unstaged.
- Verification method: Focused editor-store/history operation-count and mixed-command tests; complete suite; formatting, i18n, lint, typecheck, build, diff check; independent verification.
- Attempt count: 2
- Latest result: Approved after correction. Movement, resizing, and both Smart Layout paths use sparse reversible geometry patches in the normal chronological history without compilation, validation, schema reconciliation, complete-agent cloning, or port-cache invalidation. All-scope measurement uses captured graph references without a temporary validating store and rejects concurrent semantic replacement. Geometry targets validate atomically, and failed undo/redo retains stack ownership. Focused layout/editor tests passed 3 files / 57 tests and the complete suite passed 43 files / 424 tests; formatting, lint, typecheck, build, diff checks, and independent reverification passed.

## T006 — Add the Narrative Momentum Director built-in template

- Status: completed
- Dependencies: T005
- Integration milestone: M6
- Objective: Add a restrained observer-only long-form roleplay director with persistent narrative direction, single-generation randomized influences, manual controls, and a schema-driven runtime view.
- Source requirement IDs: REQ-009, REQ-010, REQ-016
- In scope:
  - one canonical `narrative-momentum-director.flow.json` preset built only from registered generic nodes;
  - periodic structured after-generation direction auditing with `NONE`, `KEEP`, `CREATE`, `REPLACE`, and `REMOVE` outcomes;
  - one active direction state value and one stable `UNTIL_REMOVED` direction injection;
  - probabilistic `ONCE` random-influence injection selected from configurable non-escalatory defaults;
  - manual force-audit and clear-direction flows reused by a generic runtime view;
  - template catalog registration and focused shape/compiler/runtime/catalog tests;
  - measured readable node geometry without production behavior specific to this template.
- Out of scope:
  - generation-response flows, autonomous assistant generation, template-specific TypeScript/Vue handlers, conversation summarization, thread databases, migration, compatibility aliases, or changes to the generic graph/runtime/editor contracts.
- Acceptance criteria:
  - The strict preset parser and compiler accept the checked-in asset, and installing it returns an independent editable clone.
  - No flow is generation-capable; normal generation is influenced only through the two stable injection IDs.
  - Audit execution creates/replaces, keeps, or removes the active direction exactly as directed by structured LLM output; clearing removes both state and injection.
  - Random influence uses the configured probability, is `ONCE`, chooses from the configured non-empty list, and does not accumulate stale IDs.
  - The runtime view exposes current direction plus force-audit and clear actions using only declared generic view components.
  - Focused tests, complete behavioral suite, formatting, lint, typecheck, build, and `git diff --check` pass; `vite.config.ts` remains unchanged and unstaged.
- Verification method: Strict parse/compiler/catalog assertions, deterministic runtime executions with stubbed LLM/random/host effects, complete repository gates, and independent verification.
- Attempt count: 3
- Latest result: Approved after live correction. Added a five-flow, 31-node observer-only preset with periodic/manual audit reuse, persistent direction state/injection, probabilistic one-generation influences, manual clearing, a generic runtime view, and catalog registration. A live smoke test exposed bare template variables; all now use the declared `input.*` namespace, with real host renderer coverage for random influence, direction injection, and nested configured audit prompts. The complete suite passed 44 files / 436 tests; build, typecheck, formatting, lint, diff checks, protected-file hash checks, independent verification, and focused macro reverification passed.
