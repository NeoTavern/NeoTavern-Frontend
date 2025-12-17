import type {
  ApiChatMessage,
  Character,
  ExtensionAPI,
  GenerationResponse,
  Persona,
  StreamedChunk,
} from '../../../types';
import type { RewriteSettings, RewriteTemplate } from './types';

// TODO: i18n

export class RewriteService {
  constructor(private api: ExtensionAPI<RewriteSettings>) {}

  private getSettings(): RewriteSettings {
    const defaults: RewriteSettings = {
      templates: [],
      lastUsedTemplates: {},
      templateOverrides: {},
    };
    const current = this.api.settings.get() || defaults;
    return current;
  }

  public getTemplates(): RewriteTemplate[] {
    const settings = this.getSettings();
    return settings.templates || [];
  }

  public async generateRewrite(
    input: string,
    templateId: string,
    profileName: string,
    customPromptOverride?: string,
    contextData?: { activeCharacter?: Character; characters?: Character[]; persona?: Persona },
    additionalMacros?: Record<string, unknown>,
  ): Promise<GenerationResponse | (() => AsyncGenerator<StreamedChunk>)> {
    const settings = this.getSettings();
    const template = settings.templates.find((t) => t.id === templateId);
    if (!template && !customPromptOverride) throw new Error('Template not found');

    const promptText = customPromptOverride || template?.prompt || '';
    const macroTemplate = template?.template || '{{input}}';

    // Prepare macros
    const macros = {
      input: input,
      prompt: promptText,
      ...additionalMacros, // e.g. contextMessages
    };

    // Process the template string using the core macro processor
    const processedContent = this.api.macro.process(macroTemplate, contextData, macros);

    // Build the messages array.
    // Unlike previous version, we DO NOT inject context messages automatically.
    // The template must handle context inclusion via macros (e.g. {{contextMessages}}).
    const messages: ApiChatMessage[] = [{ role: 'user', content: processedContent, name: 'User' }];

    const response = await this.api.llm.generate(messages, {
      connectionProfileName: profileName,
    });

    return response;
  }

  public extractCodeBlock(text: string): string {
    const codeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
    const match = text.match(codeBlockRegex);
    if (match && match[1]) {
      return match[1].trim();
    }
    return text.trim(); // Fallback to full text if no block found
  }
}
