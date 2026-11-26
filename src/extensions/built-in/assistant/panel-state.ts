import { reactive } from 'vue';
import type { ExtensionAPI } from '../../../types';
import { resolveConnectionProfile } from '../_shared/runtime/connection-profile';
import { isToolCallingSupported, runAgentTurn } from './agent';
import { Changeset } from './changeset';
import {
  appendUserMessage,
  composeUserContent,
  ConversationStore,
  createConversation,
  renderChangeStatusBlock,
  type AssistantConversation,
} from './conversations';
import { expandCommand, renderReferencedBlock, type AssistantRef } from './references';
import { createAssistantTools } from './tools';
import type { AssistantSettings } from './types';

export interface PanelError {
  message: string;
  /** The model's raw output, for a structured parse error. */
  rawContent?: string;
  /** The user message is saved, so running the turn again retries it. */
  canRetry: boolean;
}

/**
 * The panel's state, kept outside the component so a running turn, the draft and the open
 * conversation survive the sidebar closing and reopening.
 */
export function createPanelState(api: ExtensionAPI<AssistantSettings>, store = new ConversationStore()) {
  const t = api.i18n.t;
  const state = reactive({
    conversations: [] as AssistantConversation[],
    conversation: createConversation() as AssistantConversation,
    draft: '',
    refs: [] as AssistantRef[],
    running: false,
    error: null as PanelError | null,
  });
  let controller: AbortController | null = null;

  const changeset = () => new Changeset(state.conversation.changes);
  const save = () => store.save(state.conversation);

  async function refreshList() {
    state.conversations = await store.list();
  }

  function newConversation() {
    if (state.running) return;
    state.conversation = createConversation();
    state.error = null;
  }

  async function open(id: string) {
    if (state.running) return;
    const conversation = await store.get(id);
    if (!conversation) return;
    state.conversation = conversation;
    state.error = null;
  }

  async function remove(id: string) {
    if (state.running && state.conversation.id === id) return;
    await store.delete(id);
    if (state.conversation.id === id) newConversation();
    await refreshList();
  }

  function resolveProfile(): string | null {
    const profile = resolveConnectionProfile(api, api.settings.get().connectionProfile);
    if (!profile) {
      state.error = { message: t('extensionsBuiltin.assistant.quickEdit.noProfile'), canRetry: false };
      return null;
    }
    if (api.settings.get().requestFormat === 'tools' && !isToolCallingSupported(api, profile)) {
      state.error = { message: t('extensionsBuiltin.assistant.errors.toolsUnsupported'), canRetry: false };
      return null;
    }
    return profile;
  }

  async function send() {
    const typed = state.draft;
    if (state.running || !typed.trim()) return;
    state.error = null;
    const profile = resolveProfile();
    if (!profile) return;

    // Set before the first await, so a second Enter can't send the same draft again.
    state.running = true;
    const refs = [...state.refs];
    let content: string;
    try {
      content = composeUserContent({
        changeStatus: renderChangeStatusBlock(state.conversation.changes),
        referenced: await renderReferencedBlock(api, refs),
        text: expandCommand(typed.trim(), api.settings.get().commands),
      });
    } catch (error) {
      state.running = false;
      throw error;
    }
    appendUserMessage(state.conversation, { typed, content, refs });
    state.draft = '';
    state.refs = [];
    await runTurn(profile);
  }

  async function retry() {
    if (state.running) return;
    const profile = resolveProfile();
    if (profile) await runTurn(profile);
  }

  /** Runs the agent on the open conversation, whose last message is the user's request. Saves at the end. */
  async function runTurn(profile: string) {
    const conversation = state.conversation;
    state.running = true;
    state.error = null;
    controller = new AbortController();
    try {
      const result = await runAgentTurn(api, {
        conversation,
        tools: createAssistantTools(api, new Changeset(conversation.changes)),
        format: api.settings.get().requestFormat,
        profile,
        signal: controller.signal,
      });
      if (result.status === 'parse-error') {
        state.error = { message: result.error, rawContent: result.rawContent, canRetry: true };
      } else if (result.status === 'unsupported') {
        state.error = { message: t('extensionsBuiltin.assistant.errors.toolsUnsupported'), canRetry: true };
      } else if (result.status === 'aborted') {
        api.ui.showToast(t('extensionsBuiltin.assistant.panel.stopped'), 'info');
      }
    } catch (error) {
      console.error(error);
      state.error = { message: error instanceof Error ? error.message : String(error), canRetry: true };
    } finally {
      state.running = false;
      controller = null;
      await store.save(conversation);
      await refreshList();
    }
  }

  /** Adds a reference chip to the draft, unless it's already there. */
  function mention(ref: AssistantRef) {
    if (!state.refs.some((existing) => existing.kind === ref.kind && existing.label === ref.label)) {
      state.refs = [...state.refs, ref];
    }
  }

  function stop() {
    controller?.abort();
  }

  async function accept(ids?: string[]) {
    const set = changeset();
    const before = new Set(set.changes.filter((change) => change.status === 'conflict').map((change) => change.id));
    try {
      await set.apply(api, ids);
    } finally {
      await save();
    }
    if (set.changes.some((change) => change.status === 'conflict' && !before.has(change.id))) {
      api.ui.showToast(t('extensionsBuiltin.assistant.panel.applyConflict'), 'warning');
    }
  }

  async function reject(ids: string[]) {
    changeset().reject(ids);
    await save();
  }

  async function undoLast() {
    const result = await changeset().undoLast(api);
    await save();
    if (!result.ok) api.ui.showToast(t('extensionsBuiltin.assistant.panel.undoConflict'), 'warning');
  }

  return { state, refreshList, newConversation, open, remove, send, retry, mention, stop, accept, reject, undoLast };
}

export type PanelState = ReturnType<typeof createPanelState>;
