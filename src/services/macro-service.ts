import Handlebars from 'handlebars';
import type { Character, ChatMessage, ChatMetadata, Persona } from '../types';

export type MacroVariable = string | number;

export interface MacroContextOverrides {
  activeCharacter?: Character;
  characters?: Character[];
  persona?: Persona;
  group?: Character[];
  chatHistory?: ChatMessage[];
  chatMetadata?: ChatMetadata;
  random?: () => number;
}

export interface MacroContextData extends MacroContextOverrides {
  characters: Character[];
  additionalMacros?: Record<string, unknown>;
}

export type MacroEvaluator = (args: string[], context: MacroContextData, session: MacroEvaluationSession) => unknown;

interface MacroArity {
  minArgs?: number;
  maxArgs?: number;
  preserveRemainder?: boolean;
}

interface RegisteredMacro {
  evaluator: MacroEvaluator;
  arity?: MacroArity;
}

export class MacroEvaluationError extends Error {
  public readonly macroName?: string;

  constructor(message: string, macroName?: string) {
    super(macroName ? `Macro '${macroName}': ${message}` : message);
    this.name = 'MacroEvaluationError';
    this.macroName = macroName;
  }
}

export class MacroEvaluationSession {
  private readonly initialVariables: Record<string, MacroVariable>;
  private readonly variables: Record<string, MacroVariable>;
  private dirty = false;
  private failed = false;
  private committed = false;

  public constructor(
    private readonly service: MacroService,
    private readonly context: MacroContextData,
  ) {
    const storedVariables = context.chatMetadata?.extra?.variables;
    this.variables =
      storedVariables && typeof storedVariables === 'object' && !Array.isArray(storedVariables)
        ? { ...(storedVariables as Record<string, MacroVariable>) }
        : {};
    this.initialVariables = { ...this.variables };
  }

  public evaluate(text: string, overrides: Partial<MacroContextData> = {}): string {
    if (this.failed) {
      throw new MacroEvaluationError('The evaluation session has failed.');
    }
    if (this.committed) {
      throw new MacroEvaluationError('The evaluation session has already been committed.');
    }
    const context = {
      ...this.context,
      ...overrides,
      additionalMacros: {
        ...this.context.additionalMacros,
        ...overrides.additionalMacros,
      },
    };
    try {
      return this.service.evaluateTemplate(text, context, this, 0);
    } catch (error) {
      this.failed = true;
      for (const name of Object.keys(this.variables)) delete this.variables[name];
      Object.assign(this.variables, this.initialVariables);
      this.dirty = false;
      throw error;
    }
  }

  public commit(): boolean {
    if (this.committed || this.failed) return false;
    this.committed = true;
    if (!this.dirty || !this.context.chatMetadata) return false;

    const metadata = this.context.chatMetadata;
    metadata.extra ??= {};
    metadata.extra.variables = { ...this.variables };
    return true;
  }

  public getVariable(name: string): MacroVariable | undefined {
    return this.variables[name];
  }

  public setVariable(name: string, value: MacroVariable): void {
    this.variables[name] = value;
    this.dirty = true;
  }
}

export class MacroService {
  private static instance: MacroService;
  private readonly evaluators = new Map<string, RegisteredMacro>();
  private readonly MAX_RECURSION = 10;

  private constructor() {
    this.registerHandlebarsHelpers();
    this.registerBuiltInMacros();
  }

  public static getInstance(): MacroService {
    MacroService.instance ??= new MacroService();
    return MacroService.instance;
  }

  public register(name: string, evaluator: MacroEvaluator, arity?: MacroArity): void {
    this.evaluators.set(name, { evaluator, arity });
  }

  public createEvaluationSession(context: MacroContextData): MacroEvaluationSession {
    return new MacroEvaluationSession(this, context);
  }

  public process(text: string, contextData: MacroContextData): string {
    const session = this.createEvaluationSession(contextData);
    const result = session.evaluate(text);
    session.commit();
    return result;
  }

  public evaluateTemplate(
    text: string,
    context: MacroContextData,
    session: MacroEvaluationSession,
    depth: number,
  ): string {
    if (!text) return '';
    if (depth >= this.MAX_RECURSION) return text;

    let result = '';
    let cursor = 0;
    const rawBlocks: string[] = [];
    let containsHandlebars = false;
    let handlebarsContextDepth = 0;

    while (cursor < text.length) {
      const open = text.indexOf('{{', cursor);
      if (open === -1) {
        result += text.slice(cursor);
        break;
      }

      result += text.slice(cursor, open);

      if (text.startsWith('{{#raw}}', open)) {
        const rawEnd = text.indexOf('{{/raw}}', open + 8);
        if (rawEnd === -1) throw new MacroEvaluationError('Unterminated raw block.');
        const placeholder = `\u0000raw:${rawBlocks.length}\u0000`;
        rawBlocks.push(text.slice(open + 8, rawEnd));
        result += placeholder;
        cursor = rawEnd + 8;
        continue;
      }

      const triple = text.startsWith('{{{', open);
      const closeDelimiter = triple ? '}}}' : '}}';
      const close = text.indexOf(closeDelimiter, open + (triple ? 3 : 2));
      if (close === -1) throw new MacroEvaluationError('Unterminated macro expression.');

      const rawExpression = text.slice(open + (triple ? 3 : 2), close);
      const expression = rawExpression.trim();
      if (expression.startsWith('//')) {
        cursor = close + closeDelimiter.length;
        continue;
      }
      if (!expression) throw new MacroEvaluationError('Empty macro expression.');

      const structuredName = expression.split('::', 1)[0]?.trim() || '';
      const isStructured =
        !expression.startsWith('#') &&
        !expression.startsWith('/') &&
        !expression.startsWith('else') &&
        (expression.includes('::') || this.evaluators.has(expression) || this.hasAdditionalMacro(context, expression));

      if (isStructured) {
        const separator = rawExpression.indexOf('::');
        const name = (separator === -1 ? rawExpression : rawExpression.slice(0, separator)).trim();
        let value: unknown;
        if (this.hasAdditionalMacro(context, name)) {
          value = context.additionalMacros?.[name];
        } else {
          const definition = this.evaluators.get(name);
          if (!definition) throw new MacroEvaluationError('Unknown macro.', name);
          const parts = this.parseArguments(rawExpression, separator, definition.arity);
          this.validateArity(name, parts, definition.arity);
          try {
            value = definition.evaluator(parts, context, session);
          } catch (error) {
            if (error instanceof MacroEvaluationError) throw error;
            throw new MacroEvaluationError(error instanceof Error ? error.message : String(error), name);
          }
        }

        result += value === undefined || value === null ? '' : String(value);
        cursor = close + closeDelimiter.length;
        if (name === 'trim') {
          result = this.removeAdjacentLineBreaksFromEnd(result);
          cursor = this.skipAdjacentLineBreaks(text, cursor);
        }
        continue;
      }

      if (this.isSupportedHandlebarsExpression(expression, context, handlebarsContextDepth)) {
        result += text.slice(open, close + closeDelimiter.length);
        containsHandlebars = true;
        if (expression.startsWith('#each') || expression.startsWith('#with')) {
          handlebarsContextDepth++;
        } else if (expression.startsWith('/each') || expression.startsWith('/with')) {
          handlebarsContextDepth = Math.max(0, handlebarsContextDepth - 1);
        }
        cursor = close + closeDelimiter.length;
        continue;
      }

      throw new MacroEvaluationError('Unknown macro.', structuredName || expression);
    }

    if (containsHandlebars) {
      try {
        result = Handlebars.compile(result, { noEscape: true })(this.buildContext(context));
      } catch (error) {
        throw new MacroEvaluationError(error instanceof Error ? error.message : String(error));
      }
    }

    if (result.includes('{{') && result !== text) {
      result = this.evaluateTemplate(result, context, session, depth + 1);
    }

    return rawBlocks.reduce((current, block, index) => current.replace(`\u0000raw:${index}\u0000`, block), result);
  }

  private registerHandlebarsHelpers(): void {
    Handlebars.registerHelper('time', () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    Handlebars.registerHelper('raw', (options: Handlebars.HelperOptions) => options.fn({}));
    Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
    Handlebars.registerHelper('slice', (value: unknown, count: unknown) => {
      if (!Array.isArray(value)) return [];
      return value.slice(Number(count));
    });
    Handlebars.registerHelper('add', (a: unknown, b: unknown) => Number(a) + Number(b));
    Handlebars.registerHelper('join', (value: unknown, separator: unknown) => {
      if (!Array.isArray(value)) return '';
      return value.join(String(separator));
    });
    Handlebars.registerHelper('uppercase', (value: unknown) => String(value).toUpperCase());
    Handlebars.registerHelper('lowercase', (value: unknown) => String(value).toLowerCase());
  }

  private buildContext(data: MacroContextData): Record<string, unknown> {
    const primaryChar = data.activeCharacter || data.characters[0];
    const baseContext: Record<string, unknown> = {
      user: data.persona?.name || `{{#raw}}{{user}}{{/raw}}`,
      persona: data.persona?.description,
      char: primaryChar?.name || `{{#raw}}{{char}}{{/raw}}`,
      description: primaryChar?.description || '',
      personality: primaryChar?.personality || '',
      scenario: primaryChar?.scenario || '',
      mes_example: primaryChar?.mes_example || '',
      first_mes: primaryChar?.first_mes || '',
      alternate_greetings:
        primaryChar?.data?.alternate_greetings?.map((greeting, index) => `${index + 1}. ${greeting}`).join('\n') || '',
      chars: data.characters.map((character) => character.name),
      group: data.group,
      chat: data.chatHistory,
      chatHistory: data.chatHistory,
      chatMetadata: data.chatMetadata,
      lastMessage: this.lastMessage(data)?.mes || '',
      lastUserMessage: this.lastMatchingMessage(data, (message) => message.is_user)?.mes || '',
      lastCharMessage: this.lastMatchingMessage(data, (message) => !message.is_user && !message.is_system)?.mes || '',
    };

    return data.additionalMacros ? { ...baseContext, ...data.additionalMacros } : baseContext;
  }

  private isSupportedHandlebarsExpression(
    expression: string,
    context: MacroContextData,
    handlebarsContextDepth: number,
  ): boolean {
    const firstToken = expression.split(/\s+/, 1)[0] || '';
    if (['#if', '#unless', '#each', '#with', '/if', '/unless', '/each', '/with', 'else'].includes(firstToken)) {
      return true;
    }
    if (['join', 'slice', 'add', 'eq', 'uppercase', 'lowercase', 'time', 'lookup', 'log'].includes(firstToken)) {
      return true;
    }
    if (expression.startsWith('this') || expression.startsWith('@') || expression.startsWith('../')) return true;
    if (/^[A-Za-z_$][\w$]*(?:\.[\w$-]+)*$/.test(expression)) {
      return handlebarsContextDepth > 0 || this.hasContextPath(context, expression);
    }
    return false;
  }

  private hasContextPath(context: MacroContextData, path: string): boolean {
    const [root] = path.split('.');
    if (this.hasAdditionalMacro(context, root)) return true;
    return [
      'user',
      'persona',
      'char',
      'description',
      'personality',
      'scenario',
      'mes_example',
      'first_mes',
      'alternate_greetings',
      'chars',
      'group',
      'chat',
      'chatHistory',
      'chatMetadata',
      'lastMessage',
      'lastUserMessage',
      'lastCharMessage',
    ].includes(root);
  }

  private hasAdditionalMacro(context: MacroContextData, name: string): boolean {
    return Object.prototype.hasOwnProperty.call(context.additionalMacros || {}, name);
  }

  private removeAdjacentLineBreaksFromEnd(value: string): string {
    let result = value;
    while (result.endsWith('\n')) {
      result = result.slice(0, -1);
      if (result.endsWith('\r')) result = result.slice(0, -1);
    }
    return result;
  }

  private skipAdjacentLineBreaks(text: string, cursor: number): number {
    let result = cursor;
    while (result < text.length) {
      if (text.startsWith('\r\n', result)) {
        result += 2;
      } else if (text[result] === '\n') {
        result += 1;
      } else {
        break;
      }
    }
    return result;
  }

  private registerBuiltInMacros(): void {
    this.registerNoArgumentMacro('user', (_args, context) => context.persona?.name || '');
    this.registerNoArgumentMacro('char', (_args, context) => this.activeCharacter(context)?.name || '');
    this.registerNoArgumentMacro('group', (_args, context) => {
      const group = context.group;
      return group && group.length > 0
        ? group.map((character) => character.name).join(', ')
        : this.activeCharacter(context)?.name || '';
    });
    this.registerNoArgumentMacro('scenario', (_args, context) => this.activeCharacter(context)?.scenario || '');
    this.registerNoArgumentMacro('personality', (_args, context) => this.activeCharacter(context)?.personality || '');
    this.registerNoArgumentMacro('description', (_args, context) => this.activeCharacter(context)?.description || '');
    this.registerNoArgumentMacro('mes_example', (_args, context) => this.activeCharacter(context)?.mes_example || '');
    this.registerNoArgumentMacro('first_mes', (_args, context) => this.activeCharacter(context)?.first_mes || '');
    this.registerNoArgumentMacro('persona', (_args, context) => context.persona?.description || '');
    this.registerNoArgumentMacro('chars', (_args, context) =>
      context.characters.map((character) => character.name).join(', '),
    );
    this.registerNoArgumentMacro('time', () =>
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );
    this.registerNoArgumentMacro('trim', () => '');
    this.registerNoArgumentMacro('newline', () => '\n');
    this.registerNoArgumentMacro('noop', () => '');
    this.registerNoArgumentMacro('lastMessage', (_args, context) => this.lastMessage(context)?.mes || '');
    this.registerNoArgumentMacro(
      'lastUserMessage',
      (_args, context) => this.lastMatchingMessage(context, (message) => message.is_user)?.mes || '',
    );
    this.registerNoArgumentMacro(
      'lastCharMessage',
      (_args, context) =>
        this.lastMatchingMessage(context, (message) => !message.is_user && !message.is_system)?.mes || '',
    );

    this.register(
      'setvar',
      (args, _context, session) => {
        const name = this.variableName(args, 'setvar');
        session.setVariable(name, args[1]!);
        return '';
      },
      { minArgs: 2, maxArgs: 2, preserveRemainder: true },
    );
    this.register(
      'getvar',
      (args, _context, session) => {
        const name = this.variableName(args, 'getvar');
        const value = session.getVariable(name);
        if (value === undefined) return args[1] ?? '';
        return typeof value === 'string' && this.isNumeric(value) ? Number(value) : value;
      },
      { minArgs: 1, maxArgs: 2, preserveRemainder: true },
    );
    this.register(
      'addvar',
      (args, _context, session) => {
        const name = this.variableName(args, 'addvar');
        const current = session.getVariable(name) ?? 0;
        const addition = args[1]!;
        const value =
          this.isNumeric(current) && this.isNumeric(addition)
            ? Number(current) + Number(addition)
            : `${current}${addition}`;
        session.setVariable(name, value);
        return '';
      },
      { minArgs: 2, maxArgs: 2, preserveRemainder: true },
    );
    this.register('incvar', (args, _context, session) => this.changeVariable(args, session, 1, 'incvar'), {
      minArgs: 1,
      maxArgs: 1,
    });
    this.register('decvar', (args, _context, session) => this.changeVariable(args, session, -1, 'decvar'), {
      minArgs: 1,
      maxArgs: 1,
    });
    this.register('roll', (args, context) => this.roll(args, context));
  }

  private registerNoArgumentMacro(name: string, evaluator: MacroEvaluator): void {
    this.register(name, evaluator, { maxArgs: 0 });
  }

  private validateArity(name: string, args: string[], arity?: MacroArity): void {
    if (arity?.minArgs !== undefined && args.length < arity.minArgs) {
      if (args.length === 0 && ['setvar', 'getvar', 'addvar', 'incvar', 'decvar'].includes(name)) {
        throw new MacroEvaluationError('Variable name is required.', name);
      }
      throw new MacroEvaluationError(
        `Expected exactly ${arity.minArgs} argument${arity.minArgs === 1 ? '' : 's'}.`,
        name,
      );
    }
    if (arity?.maxArgs !== undefined && args.length > arity.maxArgs) {
      if (arity.maxArgs === 0) {
        throw new MacroEvaluationError('Does not accept arguments.', name);
      }
      throw new MacroEvaluationError(
        `Expected exactly ${arity.maxArgs} argument${arity.maxArgs === 1 ? '' : 's'}.`,
        name,
      );
    }
  }

  private parseArguments(rawExpression: string, separator: number, arity?: MacroArity): string[] {
    if (separator === -1) return [];

    const argumentText = rawExpression.slice(separator + 2);
    if (!arity?.preserveRemainder) return argumentText.split('::');

    const valueSeparator = argumentText.indexOf('::');
    if (valueSeparator === -1) return [argumentText];
    return [argumentText.slice(0, valueSeparator), argumentText.slice(valueSeparator + 2)];
  }

  private activeCharacter(context: MacroContextData): Character | undefined {
    return context.activeCharacter || context.characters[0];
  }

  private lastMessage(context: MacroContextData): ChatMessage | undefined {
    return context.chatHistory?.[context.chatHistory.length - 1];
  }

  private lastMatchingMessage(
    context: MacroContextData,
    predicate: (message: ChatMessage) => boolean,
  ): ChatMessage | undefined {
    return [...(context.chatHistory || [])].reverse().find(predicate);
  }

  private variableName(args: string[], macroName: string): string {
    const name = args[0]?.trim();
    if (!name) throw new MacroEvaluationError('Variable name is required.', macroName);
    return name;
  }

  private changeVariable(args: string[], session: MacroEvaluationSession, amount: number, macroName: string): number {
    const name = this.variableName(args, macroName);
    const current = session.getVariable(name) ?? 0;
    if (!this.isNumeric(current)) throw new MacroEvaluationError('Variable value must be numeric.', macroName);
    const result = Number(current) + amount;
    session.setVariable(name, result);
    return result;
  }

  private isNumeric(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'string' || value.trim() === '') return false;
    return Number.isFinite(Number(value));
  }

  private roll(args: string[], context: MacroContextData): number {
    const formula = args.join('::').trim();
    const match = /^(\d+)?d(\d+)([+-]\d+)?$/i.exec(formula);
    if (!match) throw new MacroEvaluationError('Invalid dice formula. Expected NdM or NdM+K.', 'roll');

    const count = Number(match[1] || 1);
    const sides = Number(match[2]);
    const modifier = Number(match[3] || 0);
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(sides) || sides < 1) {
      throw new MacroEvaluationError('Invalid dice formula.', 'roll');
    }

    const random = context.random || Math.random;
    let result = modifier;
    for (let index = 0; index < count; index++) {
      const sample = random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
        throw new MacroEvaluationError('Random source must return a number in [0, 1).', 'roll');
      }
      result += Math.floor(sample * sides) + 1;
    }
    return result;
  }
}

export const macroService = MacroService.getInstance();
