export type SnapshotEditCommand<Value> = {
  label: string;
  before: Value;
  after: Value;
};

export type ReversibleEditCommand = {
  label: string;
  undo: () => void;
  redo: () => void;
};

export type EditCommand<Value> = SnapshotEditCommand<Value> | ReversibleEditCommand;

export class CommandHistory<Value> {
  readonly #limit: number;
  #undo: EditCommand<Value>[] = [];
  #redo: EditCommand<Value>[] = [];

  constructor(limit = 100) {
    this.#limit = limit;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  record(command: EditCommand<Value>): void {
    this.#undo.push(command);
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo = [];
  }

  undo(): Value | undefined {
    const command = this.#undo.at(-1);
    if (!command) return undefined;
    if (!('before' in command)) command.undo();
    this.#undo.pop();
    this.#redo.push(command);
    return 'before' in command ? command.before : undefined;
  }

  redo(): Value | undefined {
    const command = this.#redo.at(-1);
    if (!command) return undefined;
    if (!('after' in command)) command.redo();
    this.#redo.pop();
    this.#undo.push(command);
    return 'after' in command ? command.after : undefined;
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }
}
