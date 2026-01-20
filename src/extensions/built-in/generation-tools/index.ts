import { GenerationMode } from '../../../constants';
import type { ApiChatMessage, ExtensionAPI, GenerationContext } from '../../../types';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import {
  DEFAULT_GENERATE_PROMPT,
  DEFAULT_IMPERSONATE_PROMPT,
  type ExtensionSettings,
  type RerollSnapshot,
} from './types';

export { manifest };

const DEFAULT_SETTINGS: ExtensionSettings = {
  rerollContinueEnabled: true,
  swipeEnabled: true,
  impersonateEnabled: true,
  impersonateConnectionProfile: undefined,
  impersonatePrompt: DEFAULT_IMPERSONATE_PROMPT,
  generateEnabled: true,
  generatePrompt: DEFAULT_GENERATE_PROMPT,
};

function getSettings(api: ExtensionAPI<ExtensionSettings>): ExtensionSettings {
  return api.settings.get() ?? DEFAULT_SETTINGS;
}

export function activate(api: ExtensionAPI<ExtensionSettings>) {
  let snapshot: RerollSnapshot | null = null;
  let settingsApp: { unmount: () => void } | null = null;

  // Map to store user input for special "Generate" calls, keyed by generationId
  const generateInputs = new Map<string, string>();

  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    settingsApp = api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const REROLL_BUTTON_ID = 'generation-tools-reroll';
  const SWIPE_BUTTON_ID = 'generation-tools-swipe';
  const IMPERSONATE_BUTTON_ID = 'generation-tools-impersonate';
  const GENERATE_BUTTON_ID = 'generation-tools-generate';

  const t = api.i18n.t;

  // Helper to toggle button visibility based on state
  const updateButtonState = () => {
    const settings = getSettings(api);
    const isChatActive = api.chat.getChatInfo() !== null;
    const lastMessage = api.chat.getLastMessage();
    const isLastMessageFromUser = lastMessage?.is_user ?? true; // Default to true if no message

    const rerollClick = () => rerollContinue();
    const swipeClick = () => swipe();
    const impersonateClick = () => impersonate();
    const generateClick = () => generate();

    // Reroll/Continue
    api.ui.registerChatFormOptionsMenuItem({
      id: REROLL_BUTTON_ID,
      icon: 'fa-solid fa-rotate-right',
      label: t('extensionsBuiltin.generationTools.rerollButtonLabel'),
      visible: !!snapshot && settings.rerollContinueEnabled && isChatActive,
      onClick: rerollClick,
    });
    api.ui.registerChatQuickAction('core.generation', '', {
      id: REROLL_BUTTON_ID,
      icon: 'fa-solid fa-rotate-right',
      label: t('extensionsBuiltin.generationTools.rerollButtonLabel'),
      visible: !!snapshot && settings.rerollContinueEnabled && isChatActive,
      onClick: rerollClick,
    });

    // Swipe
    api.ui.registerChatFormOptionsMenuItem({
      id: SWIPE_BUTTON_ID,
      icon: 'fa-solid fa-angles-right',
      label: t('extensionsBuiltin.generationTools.swipeButtonLabel'),
      visible: settings.swipeEnabled && isChatActive && !isLastMessageFromUser,
      onClick: swipeClick,
    });
    api.ui.registerChatQuickAction('core.generation', '', {
      id: SWIPE_BUTTON_ID,
      icon: 'fa-solid fa-angles-right',
      label: t('extensionsBuiltin.generationTools.swipeButtonLabel'),
      visible: settings.swipeEnabled && isChatActive && !isLastMessageFromUser,
      onClick: swipeClick,
    });

    // Impersonate
    api.ui.registerChatFormOptionsMenuItem({
      id: IMPERSONATE_BUTTON_ID,
      icon: 'fa-solid fa-user-secret',
      label: t('extensionsBuiltin.generationTools.impersonateButtonLabel'),
      visible: settings.impersonateEnabled && isChatActive,
      onClick: impersonateClick,
    });
    api.ui.registerChatQuickAction('core.generation', '', {
      id: IMPERSONATE_BUTTON_ID,
      icon: 'fa-solid fa-user-secret',
      label: t('extensionsBuiltin.generationTools.impersonateButtonLabel'),
      visible: settings.impersonateEnabled && isChatActive,
      onClick: impersonateClick,
    });

    // Generate
    api.ui.registerChatFormOptionsMenuItem({
      id: GENERATE_BUTTON_ID,
      icon: 'fa-solid fa-wand-magic-sparkles',
      label: t('extensionsBuiltin.generationTools.generateButtonLabel'),
      visible: settings.generateEnabled && isChatActive,
      onClick: generateClick,
    });
    api.ui.registerChatQuickAction('core.generation', '', {
      id: GENERATE_BUTTON_ID,
      icon: 'fa-solid fa-wand-magic-sparkles',
      label: t('extensionsBuiltin.generationTools.generateButtonLabel'),
      visible: settings.generateEnabled && isChatActive,
      onClick: generateClick,
    });
  };

  // 1. Capture Snapshot Logic for Reroll/Continue
  const onGenerationContext = (context: GenerationContext) => {
    if (context.mode === GenerationMode.CONTINUE) {
      const history = api.chat.getHistory();
      if (history.length === 0) return;

      const index = history.length - 1;
      const lastMessage = history[index];

      snapshot = {
        messageIndex: index,
        contentBefore: lastMessage.mes,
        swipeId: lastMessage.swipe_id ?? 0,
      };

      console.debug('[Generation Tools] Snapshot taken for message', index);
    } else if (
      context.mode === GenerationMode.NEW ||
      context.mode === GenerationMode.REGENERATE ||
      context.mode === GenerationMode.ADD_SWIPE
    ) {
      // Clear snapshot to prevent jumping back to an old state after a new generation
      snapshot = null;
    }
    updateButtonState();
  };

  // 2. Inject prompt for special "Generate" calls
  const onPromptBuilt = (messages: ApiChatMessage[], context: { generationId: string }) => {
    if (generateInputs.has(context.generationId)) {
      const settings = getSettings(api);
      const userInput = generateInputs.get(context.generationId)!;
      const processedPrompt = api.macro.process(settings.generatePrompt, undefined, { input: userInput });

      messages.push({
        role: 'system',
        content: processedPrompt,
        name: 'System',
      });

      // Clean up to prevent re-injection on retries
      generateInputs.delete(context.generationId);
    }
  };

  // 3. Generate Action
  const generate = async () => {
    const settings = getSettings(api);
    if (!settings.generateEnabled) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.generateDisabled'), 'info');
      return;
    }

    const input = api.chat.getChatInput()?.value.trim() ?? '';
    if (!input) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.generateNoInput'), 'info');
      return;
    }

    const lastMessage = api.chat.getLastMessage();
    const mode = lastMessage?.is_user ? GenerationMode.NEW : GenerationMode.ADD_SWIPE;
    const generationId = api.uuid();

    generateInputs.set(generationId, input);
    api.chat.generateResponse(mode, { generationId });
  };

  // 4. Reroll Action
  const rerollContinue = async () => {
    const settings = getSettings(api);
    if (!settings.rerollContinueEnabled) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.rerollDisabled'), 'info');
      return;
    }

    if (!snapshot) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.noSnapshot'), 'info');
      return;
    }

    const history = api.chat.getHistory();
    // Validation
    if (history.length - 1 !== snapshot.messageIndex) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.contextChanged'), 'warning');
      snapshot = null;
      updateButtonState();
      return;
    }

    const currentMessage = history[snapshot.messageIndex];

    // Basic safety check
    if (!currentMessage.mes.includes(snapshot.contentBefore)) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.divergenceError'), 'warning');
      snapshot = null;
      updateButtonState();
      return;
    }

    // Check swipe consistency
    if ((currentMessage.swipe_id ?? 0) !== snapshot.swipeId) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.swipeError'), 'warning');
      return;
    }

    api.ui.showToast(t('extensionsBuiltin.generationTools.reverting'), 'info');

    try {
      // Revert content
      await api.chat.updateMessageObject(snapshot.messageIndex, {
        mes: snapshot.contentBefore,
      });

      // Trigger Continue
      await api.chat.generateResponse(GenerationMode.CONTINUE);
    } catch (error) {
      console.error('[Generation Tools] Failed to reroll:', error);
      api.ui.showToast(t('extensionsBuiltin.generationTools.error'), 'error');
    }
  };

  // 5. Impersonate Action
  const impersonate = async () => {
    const settings = getSettings(api);
    if (!settings.impersonateEnabled) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.impersonateDisabled'), 'info');
      return;
    }

    const persone = api.persona.getActive();
    if (!persone) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.noPersona'), 'error');
      return;
    }

    let contextMessages: ApiChatMessage[] = [];
    try {
      contextMessages = await api.chat.buildPrompt();
    } catch (err) {
      console.error('[Impersonate] Failed to build prompt:', err);
      api.ui.showToast(t('extensionsBuiltin.generationTools.buildPromptFailed'), 'error');
      return;
    }

    const chatInputElement = document.querySelector('#chat-input') as HTMLTextAreaElement | null;
    const chatInput = chatInputElement?.value.trim() ?? '';

    const genMessages: ApiChatMessage[] = [...contextMessages];
    if (settings.impersonatePrompt) {
      const impersonateContent = api.macro.process(settings.impersonatePrompt);
      genMessages.push({
        role: 'system',
        content: impersonateContent,
        name: 'System',
      });
    }

    const newMessage: ApiChatMessage = {
      role: 'assistant',
      content: '',
      name: persone.name,
    };
    if (chatInput) {
      newMessage.content += chatInput;
    }
    genMessages.push(newMessage);

    if (!settings.impersonateConnectionProfile) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.noConnectionProfile'), 'error');
      return;
    }

    api.ui.showToast(t('extensionsBuiltin.generationTools.impersonating'), 'info');

    try {
      const response = await api.llm.generate(genMessages, {
        connectionProfile: settings.impersonateConnectionProfile,
      });

      let generated = chatInput;

      if (Symbol.asyncIterator in response) {
        for await (const chunk of response) {
          generated += chunk.delta ?? '';
          if (chatInputElement) {
            chatInputElement.value = generated;
            chatInputElement.dispatchEvent(new Event('input', { bubbles: true }));
            chatInputElement.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      } else {
        generated = response.content;
        if (chatInputElement) {
          chatInputElement.value = generated;
          chatInputElement.dispatchEvent(new Event('input', { bubbles: true }));
          chatInputElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } catch (error) {
      console.error('[Impersonate] Failed:', error);
      api.ui.showToast(t('extensionsBuiltin.generationTools.impersonationFailed'), 'error');
    }
  };

  // 6. Swipe Action
  const swipe = async () => {
    const settings = getSettings(api);
    if (!settings.swipeEnabled) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.swipeDisabled'), 'info');
      return;
    }

    const lastMessage = api.chat.getLastMessage();
    if (!lastMessage || lastMessage.is_user) {
      api.ui.showToast(t('extensionsBuiltin.generationTools.swipeNotApplicable'), 'warning');
      return;
    }

    const input = api.chat.getChatInput()?.value.trim() ?? '';
    const generationId = api.uuid();

    if (settings.generateEnabled && input) {
      generateInputs.set(generationId, input);
    }

    api.ui.showToast(t('extensionsBuiltin.generationTools.swiping'), 'info');
    api.chat.generateResponse(GenerationMode.ADD_SWIPE, { generationId });
  };

  // 7. Event Listeners
  const unbinds: Array<() => void> = [];

  unbinds.push(api.events.on('process:generation-context', onGenerationContext));
  unbinds.push(api.events.on('prompt:built', onPromptBuilt));
  // @ts-expect-error - Custom event for settings change
  unbinds.push(api.events.on('generation-tools:settings-changed', updateButtonState));

  // Listen for various chat events to keep button states accurate
  const updateStateAndSnapshot = () => {
    snapshot = null;
    updateButtonState();
  };
  unbinds.push(api.events.on('chat:entered', updateStateAndSnapshot));
  unbinds.push(api.events.on('message:created', updateButtonState));
  unbinds.push(api.events.on('message:deleted', updateStateAndSnapshot));
  unbinds.push(api.events.on('chat:cleared', updateStateAndSnapshot));
  unbinds.push(api.events.on('message:updated', updateButtonState));

  updateButtonState();

  return () => {
    settingsApp?.unmount();
    unbinds.forEach((u) => u());
    api.ui.unregisterChatFormOptionsMenuItem(REROLL_BUTTON_ID);
    api.ui.unregisterChatFormOptionsMenuItem(SWIPE_BUTTON_ID);
    api.ui.unregisterChatFormOptionsMenuItem(IMPERSONATE_BUTTON_ID);
    api.ui.unregisterChatFormOptionsMenuItem(GENERATE_BUTTON_ID);
    api.ui.unregisterChatQuickAction('core.generation', REROLL_BUTTON_ID);
    api.ui.unregisterChatQuickAction('core.generation', SWIPE_BUTTON_ID);
    api.ui.unregisterChatQuickAction('core.generation', IMPERSONATE_BUTTON_ID);
    api.ui.unregisterChatQuickAction('core.generation', GENERATE_BUTTON_ID);
  };
}
