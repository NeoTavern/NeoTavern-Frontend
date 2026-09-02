export type EditCommand<Value> = {
  label: string;
  before: Value;
  after: Value;
};

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
    const command = this.#undo.pop();
    if (!command) return undefined;
    this.#redo.push(command);
    return command.before;
  }

  redo(): Value | undefined {
    const command = this.#redo.pop();
    if (!command) return undefined;
    this.#undo.push(command);
    return command.after;
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }
}
