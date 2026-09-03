# Simplified Visual Custom Agents execution state

- Current plan revision: 30
- Current milestone: M3 — Activation preparation optimization complete
- Current or next bundle: Complete
- Last completed bundle: T003 — Remove repeated activation compilation while retaining automatic editor display
- Blocker: None
- Failed-attempt count: 0
- Latest important verification: Independent T003 verification passed. Focused tests passed 3 files / 18 tests; complete suite passed 43 files / 410 tests; formatting, i18n, lint, typecheck, build, and diff checks passed.
- Exact next action: None — revision-30 activation optimization is complete.

## Accepted clarifications

- Work proceeds on the current branch; do not reset to `main`.
- Nodes, schema-driven views, editor/management behavior, and Mythic remain in scope.
- Core exposes only one small single-owner awaited lifecycle provider with after-user, before-generation, and after-generation hooks.
- Graph effects mutate live selected chat/checkpoint state directly; completed effects are not rolled back after later failure or cancellation.
- Old ordered-step formats and revision-25 transaction APIs receive no compatibility layer.
- Revision 30 uses one in-memory prepared installed-agent snapshot. It adds no persistent cache, worker, background initialization, generalized repository, visibility observer, or core activation change.
- Strict candidate validation remains atomic; the same successful preparation supplies persistence and runtime replacement.
- The selected graph editor remains automatic without an open-editor interaction.
- The unrelated modified `vite.config.ts` must remain byte-for-byte unchanged and unstaged.

## Major current risks

- Retaining automatic editor construction leaves its actual UI initialization cost in activation. Further optimization requires post-refactor profiling rather than speculative machinery.
