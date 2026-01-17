import { EventPriority } from '../constants';
import { type ExtensionEventMap } from '../types/events';

type EventName = keyof ExtensionEventMap;
type Listener<E extends EventName> = (...args: ExtensionEventMap[E]) => Promise<void> | void;

interface ListenerObject<E extends EventName> {
  listener: Listener<E>;
  priority: number;
}

export class EventEmitter {
  private events: { [E in EventName]?: ListenerObject<E>[] } = {};

  on<E extends EventName>(
    eventName: E,
    listener: Listener<E>,
    priority: number | EventPriority = EventPriority.MEDIUM,
  ): () => void {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }
    const listenerObject = { listener, priority };
    this.events[eventName]!.push(listenerObject);
    this.events[eventName]!.sort((a, b) => b.priority - a.priority);
    return () => this.off(eventName, listener);
  }

  off<E extends EventName>(eventName: E, listener: Listener<E>): void {
    if (!this.events[eventName]) return;
    const index = this.events[eventName]!.findIndex((l) => l.listener === listener);
    if (index > -1) {
      this.events[eventName]!.splice(index, 1);
    }
  }

  async emit<E extends EventName>(eventName: E, ...args: ExtensionEventMap[E]): Promise<void> {
    const listeners = this.events[eventName];
    if (!listeners) return;
    for (const listenerObject of [...listeners]) {
      try {
        await listenerObject.listener(...args);
      } catch (error) {
        console.error(`Error in event listener for event "${eventName}":`, error);
      }
    }
  }
}

export const eventEmitter = new EventEmitter();
