# Simplified Visual Custom Agents

## Authority and status

- Status: Approved
- Revision: 32
- Authoritative source: This document and the user's accepted simplification on the current `custom_agents` branch.
- This revision supersedes the previous requirements for staged chat transactions, provisional projections, rollback, generation claims, and host-level generation arbitration.
- The current visual graph format, node catalog, runtime views, management UI, and Mythic graph remain product scope. This is an architectural simplification, not a reset or a reduced node/view product.

## Goals

- Keep the existing visual Custom Agent graph editor, complete generic node catalog, runtime views, import/export, and Mythic preset.
- Move graph, editor, execution, state, effects, views, and Mythic behavior behind the Custom Agents extension boundary.
- Restore NeoTavern's core chat and generation code to its normal mutation, generation, event, and save paths.
- Integrate Custom Agents through a small explicit set of awaited lifecycle hooks.
- Delete transaction machinery and generalized host orchestration added only for Custom Agents.
- Make failures and code terminology describe user operations rather than internal transaction concepts.
- Keep Custom Agent activation proportional to one required preparation of installed graphs rather than repeated validation, compilation, or hidden editor initialization.

## Non-goals

- Resetting the branch or rebuilding the visual graph feature from scratch.
- Removing nodes merely because Mythic does not currently use them.
- Removing the schema-driven runtime view system or replacing views with graph nodes.
- Migrating or accepting the removed ordered-step Custom Agent format.
- Preserving atomic rollback, provisional projections, generation claims, or branch-staleness transactions from revision 25.
- Providing arbitrary JavaScript, expressions, HTTP, CSS, or unknown-node execution.
- Redesigning unrelated core generation, chat editing, usage tracking, prompt construction, group chat, or persistence behavior.

## Requirements

### REQ-001 — Retained visual product

The existing `NEOTAVERN_CUSTOM_AGENT_FLOW` format remains the sole Custom Agent format. The following remain supported:

- all registered handwritten and tool-derived nodes;
- trigger flows, reusable subflows, nested For Each scopes, control and data edges, typed schema-derived ports, and deterministic graph scheduling;
- graph validation, compiler diagnostics, copy/paste, undo/redo, node resizing, Smart Layout, and transient run overlays;
- agent creation, duplication, rename, enable/disable, deletion, reset, strict import/export, configuration, state inspection, and manual actions;
- the generic schema-driven runtime view and action system;
- the current Mythic graph preset and its user-visible configuration, state, tables, prompts, flows, views, and generic-node implementation.

No ordered-step reader, migration, alias, version dispatch, fallback node, or compatibility path may be reintroduced.

### REQ-002 — Extension ownership

The Custom Agents extension owns:

- serialized graph contracts and schemas;
- the node and tool registry;
- validation, compilation, and execution;
- lifecycle trigger discovery and ordering;
- Custom Agent state and injection checkpoint representation;
- application of graph effects;
- prompt preparation for graph LLM nodes;
- editor, settings, transfer, diagnostics, runtime views, and Mythic data.

Core code must not import graph contracts, node definitions, compiler plans, checkpoint types, Mythic data, editor code, or Custom Agent effect types.

The extension may depend on small host-facing lifecycle and chat APIs. Dependency direction must not point from core into Custom Agents.

### REQ-003 — Minimal awaited lifecycle hooks

Core exposes one small lifecycle registration surface used by Custom Agents. It supports exactly the host moments required by the retained trigger nodes:

```ts
type ChatLifecycleHooks = {
  afterUserMessage?: (context: AfterUserMessageContext) => Promise<void>;
  beforeGeneration?: (context: BeforeGenerationContext) => Promise<BeforeGenerationResult | void>;
  afterGeneration?: (context: AfterGenerationContext) => Promise<void>;
};

type BeforeGenerationResult = {
  assistantContent?: string;
  includedPromptInjectionIds?: readonly string[];
};
```

The concrete contexts contain only the active chat identity, current selected history/target, generation mode, generated or user message where applicable, and the existing cancellation signal. `BeforeGenerationContext` also contains a mutable `promptInjections` collection for contributions to normal prompt construction. `AfterGenerationContext` contains the injection acknowledgement IDs reported for the successful generation operation. A hook-provided response reports acknowledgements through `BeforeGenerationResult.includedPromptInjectionIds`; absence means none. Contexts do not contain graph plans, staged chats, projection owners, commit callbacks, claim collectors, or rollback services.

Hook ordering is exact:

1. Core inserts the outgoing user message into the live chat.
2. `afterUserMessage` runs before that operation's existing save and before optional response generation.
3. For NEW, REGENERATE, or ADD_SWIPE, core resolves the live selected history and target, then runs `beforeGeneration` before normal prompt construction or a provider call.
4. Direct effects completed by `beforeGeneration` and its prompt injections are therefore visible to normal prompt construction. If the hook supplies `assistantContent`, no normal prompt/provider call occurs.
5. Core applies the obtained content through its existing NEW/REGENERATE/ADD_SWIPE message path, including the normal message creation/update/swipe events and any autosave scheduling those existing operations already perform.
6. `afterGeneration` runs with the accepted live assistant message after that normal message finalization and before `generation:finished` and the generation path's final save scheduling.
7. The existing generation path schedules its normal final save, which includes direct after-generation effects, and emits `generation:finished` without Custom Agent event buffering or replay.

Custom Agents does not require already-emitted message events or an already-scheduled ordinary autosave to be delayed. The final existing generation save is the persistence boundary for after-generation direct effects.

For normal generation, core copies the prompt builder's actual included injection IDs into `AfterGenerationContext`. For a hook-provided graph response, the hook returns the union of IDs actually included by graph LLM prompt builds during the successful generation flow. The extension consumes those acknowledged lifetimes during `afterGeneration`.

The registration has one owner at a time. Registering a second lifecycle provider fails explicitly. This is a hook seam, not a generalized middleware pipeline or owner-arbitration framework.

Hooks are awaited at the corresponding existing chat/generation call sites. An unregistered hook is a no-op. Hook failure propagates through the existing operation failure path. Core must not interpret Custom Agent IDs, priorities, trigger declarations, state, or effects.

Manual graph actions are invoked from the extension UI and do not require a core lifecycle hook.

### REQ-004 — Existing generation path

`beforeGeneration` may return `assistantContent`. When present, core skips its provider request and passes that content through the same existing assistant-message creation, swipe/regeneration update, event, usage-independent completion, and chat-save path used for an already obtained response.

When no content is returned, core performs normal generation unchanged. There is no claim phase, deferred owner callback, owner token, provisional response projection, or fallback decision after an owner starts.

Custom Agents resolves its own trigger ordering inside the extension. Observer flows may coexist. At most one enabled Custom Agent may contain assistant-generation trigger flows. Enabling or importing a conflicting second generation-capable agent fails validation without partially changing settings. Within that agent, more than one eligible assistant-generation flow for one invocation is an explicit Custom Agent error before either flow executes. This keeps generation selection out of core without silently choosing a winner.

A graph generation flow must return exactly one generation response on its successful path. Failure propagates and does not run default generation.

### REQ-005 — Direct live-chat behavior

Custom Agent hooks operate against the current live chat and selected branch using existing public chat operations. They must not clone the complete chat as a transaction candidate or install a temporary replacement chat.

Remove these concepts and their equivalents from production code:

- staged chat commits;
- projection owners;
- provisional chat projection and refresh;
- durable snapshot comparison for Custom Agent work;
- rollback or restoration after save;
- Custom Agent save queues layered over the normal chat save path;
- buffered re-emission of successful message events.

Graph state, injection, and visible-message effects are applied in graph execution order through extension-owned adapters. Message creation/editing uses existing chat operations so normal events and object ownership remain core-owned. Lifecycle-triggered work is persisted by the existing save already performed by the surrounding chat/generation operation. The Extension API exposes one minimal awaited `chat.save()` operation backed by the existing chat-store save path; a successful manual action calls it once after all graph nodes complete. This is not a transaction or a second save implementation.

A failed or cancelled flow stops later nodes but does not roll back effects already applied. A chat switch or concurrent edit follows existing core behavior; Custom Agents adds no stale-branch transaction. User-facing failures must not mention staging, commits, projections, ownership claims, or restoration.

### REQ-006 — State, checkpoints, and injections

Branch-associated Custom Agent state and injections remain extension data stored in chat/message metadata. The extension selects the checkpoint appropriate to the currently selected message/swipe and mutates it directly.

The retained behavior is:

- after-user flows read and update the new selected user-message checkpoint;
- generation and after-generation flows read and update the selected/generated assistant checkpoint available at their hook moment;
- manual actions use the currently selected tip;
- sibling swipes keep their separately stored checkpoint data once written;
- injection lifetimes and prompt placement remain supported.

This revision does not promise transactional isolation across an in-flight generation. Before-generation effects may remain if later provider work, a later node, or persistence fails. Cancellation prevents later execution but does not undo completed effects. Tests and UI copy must state this direct-mutation behavior rather than asserting rollback.

### REQ-007 — Graph effects

The node catalog remains unchanged, including state, injection, visible-message, and generation-response nodes. Internally these are graph effects, not "staged effects."

- State and injection effects apply immediately through extension-owned checkpoint helpers.
- Visible-message effects call existing chat creation/editing operations.
- Generation-response supplies `assistantContent` to the `beforeGeneration` hook result and does not commit a message itself.
- A second reachable generation response fails the graph invocation.

The scheduler remains deterministic and abort-aware, but it no longer accumulates a transaction for host commit. Pure data, control flow, merges, subflows, For Each, tools, LLM requests, and transient diagnostics retain their current semantics.

### REQ-008 — Prompt and LLM behavior

Graph LLM nodes continue to use `api.chat.buildPrompt(...)` for normal-chat requests so provider prefix caching and normal prompt assembly remain intact. Standalone requests, connection profiles, structured output, macros, schema validation, cancellation, unique request IDs, and `core.custom-agents` usage attribution remain.

An in-chat task excluded by prompt budgeting still fails before LLM invocation.

Prompt-injection effects remain extension-owned data. During `beforeGeneration`, the extension resolves applicable injections from the selected checkpoint and appends host `PromptInjection` values with stable acknowledgement IDs to the hook context. The existing prompt builder remains the sole authority that reports which supplied IDs survived budgeting and entered the actual prompt. Core prompt code must not understand agent checkpoints or injection lifetime rules.

During `afterGeneration`, the extension consumes `ONCE` and `FOR_N_GENERATIONS` lifetimes only for acknowledged IDs from the successful generation operation; `UNTIL_REMOVED` remains. Normal generation uses the one normal prompt build. A successful hook-provided graph response uses the union of IDs actually included by all graph LLM prompt builds in that generation flow, because those requests are part of the completed flow; the runtime does not add value-provenance tracking to identify one response-producing request. Excluded injections, failed generation flows, hook failure before content, and unacknowledged IDs are not consumed. Consumption is a direct effect and is not rolled back if the later normal chat save fails.

### REQ-009 — Graph, nodes, and schemas

The current strict data-oriented graph architecture remains authoritative:

- node definitions are plain objects, explicitly registered, and do not self-register;
- unknown nodes fail validation and execution;
- serialized ports carry schemas, while coarse connection types derive through `schemaValueType`;
- schema-aware producers expose the complete value and shallow required top-level properties;
- nested expansion uses `data.unpack-object`;
- arrays retain item schemas and For Each derives body/result schemas;
- authored labels remain literal and fixed labels use i18n;
- flows and subflow calls are acyclic; For Each is the repetition mechanism;
- execution order is deterministic and does not depend on canvas coordinates.

This simplification must not add a second graph schema authority, compatibility format, fallback execution path, arbitrary expression language, or Mythic-specific production code.

Existing validation may be simplified when rules exist solely to support removed host transaction concepts. Validation required for graph safety, typed connections, deterministic scheduling, scopes, nodes, import/export, views, and Mythic remains.

### REQ-010 — Editor, management, and views

The current Vue Flow editor remains, including inline node editing, palette, typed handles, viewport optimization, resizing, Smart Layout, edge readability, history, drafts, and diagnostics.

Runtime views remain generic, schema-driven panels with declared bindings and manual actions. They may read current validated configuration and selected checkpoint state. They must continue to work without an active chat.

Import/export remains strict and atomic at the settings-store level. Invalid or duplicate definitions do not partially mutate installed agents. This settings validation is unrelated to removed chat transaction staging.

### REQ-011 — Mythic

`presets/mythic.flow.json` remains the sole Mythic behavior payload. Mythic continues to use only public generic nodes, tools, subflows, configuration, state, and views available to user-authored agents. Production code contains no Mythic IDs, field-name checks, handlers, or Vue components.

Representative Fate, event, narration, scene, manual-action, view, prompt, and transfer behavior must remain tested. Tests that previously asserted staged rollback or host generation arbitration must be rewritten for the direct lifecycle model rather than retained under different names.

### REQ-012 — Core-diff budget and deletion requirement

Every production change outside `src/extensions/built-in/custom-agents/` must be justified by one of these boundaries:

- registering/mounting the extension;
- the minimal lifecycle hook service and its three call sites;
- passing an optional hook-provided assistant response or prompt injections into an existing generation path;
- the existing public chat/prompt API required by an extension;
- Vue Flow dependency, shared style registration, locales, or generated i18n types.

Changes to unrelated extension behavior, generic chat serialization, autosave queuing, message editing, usage storage, group-chat generation, media utilities, preset APIs, settings migration, or generic event semantics are prohibited unless compilation proves a concrete necessary call-site adjustment. Such an adjustment must be smaller than preserving the branch's generalized Custom Agent framework.

The implementation must delete obsolete transaction and orchestration production code and tests rather than leave dead adapters, aliases, optional legacy callbacks, or compatibility wrappers.

### REQ-013 — Bounded activation work

Custom Agent activation prepares installed settings once and retains both the canonical definitions and compiled runtime plans. Runtime reads reuse that in-memory snapshot until a successful settings mutation replaces it; they must not reload, stringify, validate, or compile the installed collection on every lifecycle or view read.

A settings mutation remains strict and atomic: its candidate collection is validated and compiled before persistence or runtime replacement, and the same prepared result supplies both operations. Activation and settings mutation must not validate or compile the same unchanged graph through separate store, runtime, or management paths.

Activation must not validate or compile the bundled template catalog merely because the extension settings container exists. The selected agent's editor remains displayed automatically without an additional open-editor interaction; deferment or visibility-observer machinery is not part of this optimization. Installing a template still performs normal strict collection validation before changing installed settings.

This optimization must use one direct prepared-snapshot owner. Do not add persistent compiled caches, workers, background initialization, compatibility APIs, generalized repositories, invalid-data fallbacks, or changes to core extension activation ordering.

### REQ-014 — Responsive editor derivation and metadata updates

Selecting a flow or nested scope is a navigation operation. It must not validate or compile the complete agent. Editor port derivation must follow data dependencies deterministically without unconditional node-count passes, repeated full-edge scans, recursive re-resolution of the same nested body, or large serialized cache fingerprints. Reopening an unchanged scope may reuse its resolved result for the current draft identity; any draft replacement invalidates that reuse directly.

The editor may trust the already prepared installed definition when it is first constructed instead of compiling that same definition again. Subsequent graph edits, reset, undo, redo, and apply eligibility retain strict diagnostics.

Changing agent name, priority, or enabled state still performs the one required strict installed-collection preparation from REQ-013, including generation-owner checks. Synchronizing those metadata fields into an existing editor must not trigger a second complete graph validation. Configuration, schema, flow, node, edge, and view changes retain normal graph validation.

Use direct dependency ordering, pre-indexed edges, and draft-scoped memoization only where required by these operations. Do not add workers, background validation, persistent caches, debounce delays, arbitrary performance thresholds, or a generalized incremental compiler.

### REQ-015 — Geometry-only editor commands

Node movement, node resizing, single-scope Smart Layout, and all-scope Smart Layout change only serialized presentation geometry. These operations must remain undoable in normal chronological history, but must not compile or validate the graph, reconcile schema-editor buffers, or invalidate resolved port derivation for unchanged graph semantics.

A geometry command records only the node positions or sizes required to undo and redo that command. Applying or restoring it must not deep-clone the complete agent. It may issue the minimal reactive draft notification needed to update Vue Flow while preserving graph, schema, node data, input value, and flow-signature identities.

Semantic edits, including nodes, edges, node data, input values, flow signatures, schemas, configuration, and views, retain full validation and existing snapshot history semantics. Geometry and semantic commands must interleave correctly through undo and redo. No debounce, delayed commit, worker, persistent cache, or alternate non-serialized viewport state may be introduced.

## Failure behavior

- Invalid graph/settings/import data fails before installation or execution.
- Hook and graph failures propagate through the existing operation error surface.
- Generation-flow failure does not invoke default generation.
- Cancellation stops pending work and later nodes but does not roll back completed direct effects.
- A conflicting generation-capable enabled agent or multiple eligible generation flows fails explicitly.
- No user-visible error may expose the removed terms `staged chat`, `commit`, `projection owner`, `claim arbitration`, or `restoration`.

## Completion requirements

- The full node catalog, views, editor, management, import/export, and Mythic preset remain operational.
- Custom Agent graph/runtime code is extension-owned and core does not import it.
- Core has only the minimal awaited lifecycle seam and uses its existing message mutation and save paths.
- `commitStagedChat`, staged projection APIs, generation claims/arbitration, Custom Agent rollback/restoration, and equivalent tests are absent.
- A diff against `main` confirms every remaining non-extension production change fits REQ-012.
- Focused lifecycle tests cover normal generation, one graph-provided response, observers, hook failure, cancellation, direct effects, manual save, and generation-agent conflicts.
- Representative graph/editor/view/Mythic tests remain.
- Formatting, i18n generation when required, lint, the complete Vitest suite, typecheck, production build, and `git diff --check` pass.
- The complete-suite gate is `npm test`.
- The unrelated working-tree modification to `vite.config.ts` remains byte-for-byte unchanged and is never staged or reverted.
