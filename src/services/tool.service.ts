import Ajv from 'ajv';
import { isCapabilitySupported } from '../api/provider-definitions';
import { CustomPromptPostProcessing } from '../constants';
import { useApiStore } from '../stores/api.store';
import { useSettingsStore } from '../stores/settings.store';
import { useToolStore } from '../stores/tool.store';
import { type ApiProvider } from '../types/api';
import type { ApiChatToolCall, ApiToolDefinition } from '../types/generation';
import type { ToolDefinition, ToolInvocation } from '../types/tools';
import { eventEmitter } from '../utils/extensions';
import { parseResponse } from '../utils/structured-response';

const ajv = new Ajv({
  coerceTypes: true,
  allErrors: true,
  strict: false,
});

export class ToolService {
  /**
   * Converts a single tool definition to the API format.
   */
  static toApiTool(tool: ToolDefinition): ApiToolDefinition {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  /**
   * Converts registered enabled tools to the OpenAI API tool definition format.
   */
  static getTools(): ApiToolDefinition[] {
    const toolStore = useToolStore();
    const result: ApiToolDefinition[] = [];

    for (const tool of toolStore.enabledTools) {
      result.push(this.toApiTool(tool));
    }

    return result;
  }

  /**
   * Safe parameter parsing helper.
   * Handles string JSON, empty strings, pre-parsed objects, and code-block-wrapped content.
   * Validates against schema if provided. Throws on validation or parsing errors.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static parseParameters(parameters: string | object | unknown, schema?: any): Record<string, unknown> {
    if (parameters === '' || parameters === null || parameters === undefined) {
      return {};
    }
    if (typeof parameters === 'object') {
      const obj = parameters as Record<string, unknown>;
      if (schema) {
        const validate = ajv.compile(schema);
        const valid = validate(obj);
        if (!valid) {
          const errors = validate.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ');
          throw new Error(`Schema validation failed: ${errors}`);
        }
      }
      return obj;
    }
    if (typeof parameters === 'string') {
      // Use parseResponse to handle code blocks and plain JSON robustly, with optional schema validation
      const parsed = parseResponse(parameters, 'json', { schema });
      return parsed as Record<string, unknown>;
    }
    return {};
  }

  /**
   * Invokes a single tool by name with provided arguments.
   */
  static async invokeTool(name: string, args: string | object): Promise<string> {
    const toolStore = useToolStore();
    const tool = toolStore.getTool(name);

    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    try {
      const parsedArgs = this.parseParameters(args, tool.parameters);
      const result = await tool.action(parsedArgs);

      if (typeof result === 'string') return result;
      return JSON.stringify(result);
    } catch (error) {
      console.error(`[ToolService] Error invoking tool ${name}:`, error);
      if (error instanceof Error) {
        return `Error: ${error.message}`;
      }
      return 'Unknown error occurred during tool execution.';
    }
  }

  /**
   * Formats the tool invocation for display (e.g. system message).
   */
  static async formatToolMessage(name: string, args: string | object): Promise<string> {
    const toolStore = useToolStore();
    const tool = toolStore.getTool(name);

    if (!tool) return `Invoking tool: ${name}`;

    try {
      const parsedArgs = this.parseParameters(args, tool.parameters);
      if (tool.formatMessage) {
        return await tool.formatMessage(parsedArgs);
      }
      return `Invoking tool: ${tool.displayName || tool.name}`;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      return `Invoking tool: ${tool.displayName || tool.name}`;
    }
  }

  /**
   * Processes a list of raw tool calls from the API, invokes them, and returns the results.
   */
  static async processToolCalls(toolCalls: ApiChatToolCall[]): Promise<{
    invocations: ToolInvocation[];
    stealthCalls: string[];
    errors: Error[];
  }> {
    const invocations: ToolInvocation[] = [];
    const stealthCalls: string[] = [];
    const errors: Error[] = [];
    const toolStore = useToolStore();

    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return { invocations, stealthCalls, errors };
    }

    for (const call of toolCalls) {
      if (call.type !== 'function') continue;

      const { name, arguments: args } = call.function;
      const tool = toolStore.getTool(name);

      if (!tool) {
        const error = new Error(`Unknown tool: ${name}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error as any).cause = name;
        errors.push(error);
        continue;
      }

      try {
        const displayMessage = await this.formatToolMessage(name, args);
        await eventEmitter.emit('tool:call-started', { name, message: displayMessage });

        const result = await this.invokeTool(name, args);

        if (tool.stealth) {
          stealthCalls.push(name);
        } else {
          invocations.push({
            id: call.id,
            name: name,
            displayName: tool.displayName || name,
            parameters: typeof args === 'string' ? args : JSON.stringify(args),
            result: result,
            signature: call.signature, // Pass through signature (e.g. Google thought signature, OR encryption)
          });
        }
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any).cause = name;
        errors.push(err as Error);
      }
    }

    if (invocations.length > 0) {
      await eventEmitter.emit('tool:calls-performed', invocations);
    }

    return { invocations, stealthCalls, errors };
  }

  /**
   * Checks if tool calling is supported for the current configuration.
   * generation.ts is already calling this. So no need to call earlier.
   */
  static isToolCallingSupported(
    provider: ApiProvider,
    model: string,
    customPromptPostProcessing: CustomPromptPostProcessing,
    bypassGlobalCheck: boolean = false,
  ): boolean {
    const apiStore = useApiStore();
    const settingsStore = useSettingsStore();

    // 1. Check if globally enabled in settings (unless bypassed)
    if (!bypassGlobalCheck && !settingsStore.settings.api.toolsEnabled) {
      return false;
    }

    // 2. Check Custom Prompt Post Processing compatibility
    const allowed = [
      CustomPromptPostProcessing.NONE,
      CustomPromptPostProcessing.MERGE_TOOLS,
      CustomPromptPostProcessing.SEMI_TOOLS,
      CustomPromptPostProcessing.STRICT_TOOLS,
    ];

    // If the current post-processing method is NOT in the allowed list,
    // it means it likely strips tools or format, so we disable tool calling.
    if (!allowed.includes(customPromptPostProcessing)) {
      return false;
    }

    // 3. Provider/Model Check using Capability Definitions
    // We pass the full model list from the store to allow metadata checks (e.g. OpenRouter/ElectronHub)
    return isCapabilitySupported('tools', provider, model, apiStore.modelList);
  }
}
