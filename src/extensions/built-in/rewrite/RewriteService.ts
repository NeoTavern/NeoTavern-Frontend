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
    argOverrides?: Record<string, boolean | number | string>,
    signal?: AbortSignal,
  ): Promise<GenerationResponse | (() => AsyncGenerator<StreamedChunk>)> {
    const settings = this.getSettings();
    const template = settings.templates.find((t) => t.id === templateId);
    if (!template && !customPromptOverride) throw new Error('Template not found');

    const promptText = customPromptOverride || template?.prompt || '';
    const macroTemplate = template?.template || '{{input}}';

    // Resolve custom args
    const args: Record<string, unknown> = {};
    if (template?.args) {
      for (const arg of template.args) {
        // Use override if present, else default, else undefined (though types say mandatory default)
        args[arg.key] = argOverrides?.[arg.key] ?? arg.defaultValue;
      }
    }

    // Prepare macros
    const macros = {
      input: input,
      prompt: promptText,
      ...args,
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
      signal,
    });

    return response;
  }

  public extractCodeBlock(text: string): string {
    // Try complete code block first (opening and closing ```)
    const completeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
    const completeMatch = text.match(completeBlockRegex);
    if (completeMatch && completeMatch[1]) {
      return completeMatch[1].trim();
    }

    // Try incomplete code block (has opening ``` but no closing, e.g., aborted generation)
    const incompleteBlockRegex = /```(?:[\w]*\n)?([\s\S]*)/i;
    const incompleteMatch = text.match(incompleteBlockRegex);
    if (incompleteMatch && incompleteMatch[1]) {
      return incompleteMatch[1].trim();
    }

    // No code blocks found, return full text
    return text.trim();
  }
}
