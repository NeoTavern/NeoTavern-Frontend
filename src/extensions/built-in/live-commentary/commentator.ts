import Bowser from 'bowser';
import type { ApiChatMessage, Character, ExtensionAPI } from '../../../types';
import { DEFAULT_SETTINGS, type LiveCommentarySettings, type RecentCommentary } from './types';

// TODO: i18n

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 1) return `${days} days`;
  if (days === 1) return '1 day';
  if (hours > 1) return `${hours} hours`;
  if (hours === 1) return '1 hour';
  if (minutes > 1) return `${minutes} minutes`;
  if (minutes === 1) return '1 minute';
  if (seconds > 10) return `${seconds} seconds`;
  return 'just now';
}

export class Commentator {
  private ongoingControllers = new Map<string, AbortController>(); // character.avatar -> AbortController
  private lastGenerationTimes = new Map<string, number>(); // character.avatar -> Timestamp (ms)
  private typingCharacters = new Set<string>(); // character.avatar -> boolean (is bubble typing)
  private debounceTimer: number | null = null;
  private typingStartTime: number | null = null;
  private deletedMessageCount = 0;
  private editedMessageIndices = new Set<number>();
  private lastGenerationTriggerTime = 0;

  // Stores commentaries for the current typing session (cleared on reset/input start)
  private recentCommentaries: RecentCommentary[] = [];

  // Stores commentaries specifically for the next generation context injection
  // These are moved from recentCommentaries when resetContext is called (e.g., user sends message)
  private pendingInjectionCommentaries: RecentCommentary[] = [];

  private lastTriggeredInput: string | null = null;
  private activeGenerationCharacter: string | null = null; // Avatar of the character currently generating

  constructor(private api: ExtensionAPI<LiveCommentarySettings>) {}

  private getSettings(): LiveCommentarySettings {
    return {
      ...DEFAULT_SETTINGS,
      ...(this.api.settings.get() || {}),
    };
  }

  public trigger(userInput: string): void {
    const settings = this.getSettings();
    if (!settings.enabled) {
      return;
    }

    const trimmedInput = userInput.trim();
    const now = Date.now();

    // --- Reset logic: User cleared the input ---
    if (!trimmedInput) {
      this.typingStartTime = null;
      this.cancelOngoingRequests();
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.lastTriggeredInput = null;
      this.lastGenerationTriggerTime = 0;
      return;
    }

    // --- Session start logic: User started typing from an empty input ---
    if (this.typingStartTime === null) {
      this.typingStartTime = now;
      // Start of new typing session - if there were pending injections from a previous abandoned session, clear them
      this.pendingInjectionCommentaries = [];
      this.cancelOngoingRequests();
    }

    // Don't re-evaluate if the input content is identical to what we last successfully triggered on.
    if (trimmedInput === this.lastTriggeredInput) {
      return;
    }

    // Clear any pending debounce timer from the previous keystroke.
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const timeSinceLastTrigger = now - this.lastGenerationTriggerTime;
    const hasMaxWaitPassed =
      settings.maxWaitMs > 0 && this.lastGenerationTriggerTime > 0 && timeSinceLastTrigger >= settings.maxWaitMs;

    const executeGeneration = () => {
      // Final check to ensure we don't send a request for the same text twice.
      if (trimmedInput === this.lastTriggeredInput) {
        return;
      }

      if (this.ongoingControllers.size > 0) {
        return;
      }

      this.lastTriggeredInput = trimmedInput;
      this.lastGenerationTriggerTime = Date.now();
      this.debounceTimer = null;
      this.generateForAllCharacters(trimmedInput);
    };

    if (hasMaxWaitPassed) {
      executeGeneration();
    } else {
      this.debounceTimer = window.setTimeout(executeGeneration, settings.debounceMs);
    }
  }

  private cancelOngoingRequests(): void {
    if (this.ongoingControllers.size === 0) return;
    for (const controller of this.ongoingControllers.values()) {
      controller.abort();
    }
    this.ongoingControllers.clear();
  }

  public setCharacterTyping(avatar: string, isTyping: boolean): void {
    if (isTyping) {
      this.typingCharacters.add(avatar);
    } else {
      this.typingCharacters.delete(avatar);
    }
  }

  private async generateForAllCharacters(userInput: string): Promise<void> {
    const characters = this.api.character.getActives();
    const settings = this.getSettings();
    const now = Date.now();

    for (const char of characters) {
      if (this.typingCharacters.has(char.avatar)) {
        continue;
      }

      const lastGenTime = this.lastGenerationTimes.get(char.avatar) || 0;
      if (now - lastGenTime < settings.minIntervalMs) {
        continue;
      }

      // Fire and forget
      this.generateForCharacter(char, userInput).catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error(`Failed to generate commentary for ${char.name}`, error);
        }
      });
    }
  }

  private async generateForCharacter(character: Character, userInput: string): Promise<void> {
    const settings = this.getSettings();
    const connectionProfile =
      settings.connectionProfile || this.api.settings.getGlobal('api.selectedConnectionProfile');
    if (!connectionProfile) {
      if (this.ongoingControllers.size === 0) {
        this.api.ui.showToast('Live Commentary: No connection profile selected.', 'warning');
      }
      return;
    }

    const controller = new AbortController();
    this.ongoingControllers.set(character.avatar, controller);

    try {
      const chatHistory = this.api.chat.getHistory();
      const allActiveChars = this.api.character.getActives();
      const recent_chat = chatHistory.slice(-5);

      // --- Basic Meta Context ---
      const lastMessage = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
      const timeSinceLastMessage = lastMessage
        ? formatDuration(Date.now() - new Date(lastMessage.send_date).getTime())
        : 'this is the first message';
      const typingDuration = this.typingStartTime ? formatDuration(Date.now() - this.typingStartTime) : 'a moment';

      // --- Device Info ---
      const browser = Bowser.getParser(window.navigator.userAgent);
      const osName = browser.getOSName(true) || 'unknown OS';
      const platformType = browser.getPlatformType(true) || 'unknown device';
      const browserName = browser.getBrowserName(true) || 'unknown browser';

      const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const deviceInfo = `${capitalize(osName)} ${capitalize(platformType)}`;
      const browserInfo = capitalize(browserName);

      // --- Advanced Meta Context ---
      const chatLength = chatHistory.length;
      const otherCharacters = allActiveChars.filter((c) => c.avatar !== character.avatar).map((c) => c.name);

      let swipeCount = 0;
      let wasEdited = false;
      let generationDuration = 0;

      // Find the last message from this specific character to get advanced stats
      let lastBotMessageIndex = -1;
      for (let i = chatHistory.length - 1; i >= 0; i--) {
        const msg = chatHistory[i];
        if (!msg.is_user && msg.original_avatar === character.avatar) {
          lastBotMessageIndex = i;
          break;
        }
      }

      if (lastBotMessageIndex !== -1) {
        const lastBotMessage = chatHistory[lastBotMessageIndex];
        swipeCount = lastBotMessage.swipes?.length ?? 1;
        wasEdited = this.editedMessageIndices.has(lastBotMessageIndex);

        if (lastBotMessage.gen_finished && lastBotMessage.gen_started) {
          const start = new Date(lastBotMessage.gen_started).getTime();
          const end = new Date(lastBotMessage.gen_finished).getTime();
          if (!isNaN(start) && !isNaN(end) && end > start) {
            generationDuration = parseFloat(((end - start) / 1000).toFixed(2));
          }
        }
      }

      const prompt = this.api.macro.process(
        settings.prompt,
        {
          activeCharacter: character,
          characters: allActiveChars,
          persona: this.api.persona.getActive() ?? undefined,
        },
        {
          userInput: userInput,
          recent_chat: recent_chat,
          date: new Date().toLocaleDateString(),
          time: new Date().toLocaleTimeString(),
          timeSinceLastMessage: timeSinceLastMessage,
          typingDuration: typingDuration,
          recentCommentaries: this.recentCommentaries,
          deviceInfo: deviceInfo,
          browserInfo: browserInfo,
          // Advanced meta
          chatLength: chatLength,
          otherCharacters: otherCharacters,
          swipeCount: swipeCount,
          wasEdited: wasEdited,
          generationDuration: generationDuration,
          deletedMessageCount: this.deletedMessageCount,
        },
      );

      const messages: ApiChatMessage[] = [{ role: 'system', content: prompt, name: 'System' }];

      const response = await this.api.llm.generate(messages, {
        connectionProfile,
        signal: controller.signal,
      });

      let thought = '';
      if (Symbol.asyncIterator in response) {
        for await (const chunk of response) {
          if (controller.signal.aborted) return;
          thought += chunk.delta;
        }
      } else {
        thought = response.content;
      }

      const codeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
      const match = thought.match(codeBlockRegex);
      if (match && match[1]) {
        thought = match[1].trim();
      }

      if (thought.trim()) {
        this.lastGenerationTimes.set(character.avatar, Date.now());

        const commentary: RecentCommentary = {
          characterName: character.name,
          characterAvatar: character.avatar,
          userInput: userInput,
          thought: thought.trim(),
          timestamp: Date.now(),
        };

        this.recentCommentaries.push(commentary);

        if (this.recentCommentaries.length > settings.maxCommentaryHistory) {
          this.recentCommentaries.shift();
        }

        // @ts-expect-error custom event
        this.api.events.emit('commentary:generated', character.avatar, thought.trim());
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('Live Commentary generation failed', error);
      this.api.ui.showToast(`Commentary for ${character.name} failed`, 'error');
    } finally {
      this.ongoingControllers.delete(character.avatar);
    }
  }

  /**
   * Called when a user message is created or context needs reset.
   * Moves recent commentaries to pending injection for the upcoming response.
   */
  public resetContext(): void {
    // If there are recent commentaries, preserve them for the immediate next generation
    if (this.recentCommentaries.length > 0) {
      // Append current session to pending, but keep the overall pending list reasonably sized
      this.pendingInjectionCommentaries = [...this.pendingInjectionCommentaries, ...this.recentCommentaries].slice(-10);
    }

    this.typingStartTime = null;
    this.recentCommentaries = [];
    this.lastTriggeredInput = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.lastGenerationTriggerTime = 0;
    this.cancelOngoingRequests();
  }

  public incrementDeletedMessageCount(count: number): void {
    this.deletedMessageCount += count;
  }

  public markMessageAsEdited(index: number): void {
    this.editedMessageIndices.add(index);
  }

  public cancel(): void {
    this.resetContext();
    this.pendingInjectionCommentaries = []; // Full reset
    this.lastGenerationTimes.clear();
    this.typingCharacters.clear();
    this.deletedMessageCount = 0;
    this.editedMessageIndices.clear();
  }

  public setActiveGenerationCharacter(avatar: string | undefined): void {
    this.activeGenerationCharacter = avatar || null;
  }

  /**
   * Injects pending thoughts into the prompt messages.
   */
  public injectThoughts(messages: ApiChatMessage[]): ApiChatMessage[] {
    const settings = this.getSettings();
    if (!settings.injectionEnabled || this.pendingInjectionCommentaries.length === 0) {
      return messages;
    }

    // Determine which character is speaking
    // We can rely on setActiveGenerationCharacter having been called,
    // or we can just inject everything if we want to support group chats loosely.
    // The prompt requested: "Inject last X thoughts for the speaking character."

    let commentariesToInject = this.pendingInjectionCommentaries;

    if (this.activeGenerationCharacter) {
      commentariesToInject = commentariesToInject.filter((c) => c.characterAvatar === this.activeGenerationCharacter);
    }

    if (commentariesToInject.length === 0) {
      return messages;
    }

    // Sort by timestamp (asc) and take last X
    commentariesToInject.sort((a, b) => a.timestamp - b.timestamp);
    const slicedCommentaries = commentariesToInject.slice(-settings.injectionDepth);

    // Format thoughts
    const thoughtsText = slicedCommentaries
      .map((c) =>
        this.api.macro.process(settings.injectionTemplate, undefined, {
          char: c.characterName,
          thought: c.thought,
        }),
      )
      .join('\n');

    if (!thoughtsText) return messages;

    const resultMessages = [...messages];

    // Position logic
    if (settings.injectionPosition === 'before_last_user_message') {
      let inserted = false;
      // Find the last user message from the end
      for (let i = resultMessages.length - 1; i >= 0; i--) {
        if (resultMessages[i].role === 'user') {
          // Insert system message with thoughts before it
          resultMessages.splice(i, 0, {
            role: 'system',
            name: 'System',
            content: thoughtsText,
          });
          inserted = true;
          break;
        }
      }
      // Fallback if no user message found
      if (!inserted) {
        resultMessages.push({
          role: 'system',
          name: 'System',
          content: thoughtsText,
        });
      }
    } else {
      // 'end_of_context' - just append a system message at the end
      resultMessages.push({
        role: 'system',
        name: 'System',
        content: thoughtsText,
      });
    }

    return resultMessages;
  }

  /**
   * Called when generation finishes to clear injected thoughts so they don't persist to next turn
   */
  public onGenerationFinished(): void {
    this.pendingInjectionCommentaries = [];
    this.activeGenerationCharacter = null;
  }
}
