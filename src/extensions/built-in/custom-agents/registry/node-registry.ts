import type { ReadonlyNodeRegistry, RegisteredNodeDefinition } from './node-definition';

export class NodeRegistry implements ReadonlyNodeRegistry {
  readonly #definitions = new Map<string, RegisteredNodeDefinition>();

  constructor(definitions: readonly RegisteredNodeDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: RegisteredNodeDefinition): void {
    if (this.#definitions.has(definition.type)) throw new Error(`Duplicate node type ${definition.type}`);
    Object.freeze(definition.runtime);
    this.#definitions.set(definition.type, Object.freeze(definition));
  }

  get(type: string): RegisteredNodeDefinition | undefined {
    return this.#definitions.get(type);
  }

  list(): readonly RegisteredNodeDefinition[] {
    return Object.freeze([...this.#definitions.values()]);
  }
}
