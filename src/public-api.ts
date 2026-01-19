export * from './constants';
export { type PromptBuilder } from './services/prompt-engine';
export { type WorldInfoProcessor } from './services/world-info';
export type {
  ApiChatMessage,
  Character,
  ChatCompletionPayload,
  ChatMessage,
  ExtensionAPI,
  GenerationResponse,
  Persona,
  Settings,
  SettingsPath,
  StreamedChunk,
  WorldInfoBook,
  WorldInfoEntry,
} from './types';

import type * as Vue from 'vue';
import type { ExtensionAPI } from './types';

declare global {
  var NeoTavern: {
    /**
     * The instance of Vue being used by the main application.
     * Extensions can use this to create their own components.
     */
    vue: typeof Vue;

    /**
     * The entry point for an extension to register itself with NeoTavern.
     * @param extensionName A unique name for your extension.
     * @param initCallback The function that will be called to initialize your extension.
     */
    registerExtension: (
      extensionName: string,
      initCallback: (extensionName: string, api: ExtensionAPI) => void,
    ) => void;
    api: ExtensionAPI;
  };
}
