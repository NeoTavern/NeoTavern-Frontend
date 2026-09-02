# Simplified Visual Custom Agents execution state

- Current plan revision: 29
- Current milestone: M2 — Core-diff minimization complete
- Current or next bundle: Complete
- Last completed bundle: T002 — Minimize the remaining core diff and verify the repository
- Blocker: None
- Failed-attempt count: 0
- Latest important verification: Follow-up verification passed 43 files / 406 tests plus i18n, lint, typecheck, build, and diff checks. Coverage collection/configuration was removed, and the Usage Tracker copy-trace workflow was retained for debugging core and extension requests.
- Exact next action: None — revision-29 simplification plan and requested follow-ups are complete.

## Accepted clarifications

- Work proceeds on the current branch; do not reset to `main`.
- Nodes, schema-driven views, editor/management behavior, and Mythic remain in scope.
- Core exposes only one small single-owner awaited lifecycle provider with after-user, before-generation, and after-generation hooks.
- Lifecycle ordering is exact: after-user follows live insertion; before-generation precedes prompt/provider work; after-generation follows accepted assistant finalization and normal message events but precedes final generation save scheduling and `generation:finished`.
- A graph-provided assistant response and its prompt-injection acknowledgement IDs enter the existing core assistant-message and save path.
- Normal prompt building accepts hook-contributed injections and returns included IDs. A successful graph generation flow returns the union of IDs included by its graph LLM requests; no graph value-provenance system is added.
- Graph effects mutate live selected chat/checkpoint state directly; completed effects are not rolled back after later failure or cancellation.
- One awaited `ExtensionAPI.chat.save()` exposes the existing save path for successful manual actions.
- Custom Agents owns trigger ordering. Core performs no generation claim collection or owner arbitration.
- At most one enabled generation-capable Custom Agent is allowed; observer-only agents may coexist.
- Old ordered-step formats and revision-25 transaction APIs receive no compatibility layer.
- The unrelated modified `vite.config.ts` must remain byte-for-byte unchanged and unstaged.

## Major current risks

- The existing transaction architecture is deeply coupled to generation and chat-store tests; removal must restore normal core behavior rather than reproduce it under new names.
- Supplying a graph response through the existing NEW/REGENERATE/ADD_SWIPE path must not create a second message path.
- Direct checkpoint effects intentionally weaken failure isolation; tests and UI errors must stop promising rollback.
- Core-diff minimization must not accidentally remove the retained prompt-building API required by graph LLM nodes.
