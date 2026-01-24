import { describe, expect, it } from 'vitest';
import type { ApiChatMessage } from '../src/types/generation';
import { NamesBehavior, type InstructTemplate } from '../src/types/instruct';
import { convertMessagesToInstructString } from '../src/utils/instruct';

describe('convertMessagesToInstructString', () => {
  const basicTemplate: InstructTemplate = {
    id: 'test-template',
    name: 'Test Template',
    input_sequence: '<|im_start|>user\n',
    output_sequence: '<|im_start|>assistant\n',
    system_sequence: '<|im_start|>system\n',
    input_suffix: '<|im_end|>\n',
    output_suffix: '<|im_end|>\n',
    system_suffix: '<|im_end|>\n',
    first_output_sequence: '',
    last_output_sequence: '',
    last_system_sequence: '',
    first_input_sequence: '',
    last_input_sequence: '',
    stop_sequence: '<|im_end|>',
    sequences_as_stop_strings: true,
    wrap: false,
    macro: false,
    names_behavior: NamesBehavior.NONE,
    skip_examples: false,
    user_alignment_message: '',
    system_same_as_user: false,
  };

  describe('basic message formatting', () => {
    it('should format a single system message', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'system',
          content: 'You are a helpful assistant.',
          name: 'System',
        },
      ];

      const result = convertMessagesToInstructString(messages, basicTemplate, 'User', 'Assistant');

      // When last message is not assistant, output sequence is added
      expect(result).toBe('<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n<|im_start|>assistant\n');
    });

    it('should format a user message', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'Hello!',
          name: 'User',
        },
      ];

      const result = convertMessagesToInstructString(messages, basicTemplate, 'User', 'Assistant');

      expect(result).toBe('<|im_start|>user\nHello!<|im_end|>\n<|im_start|>assistant\n');
    });

    it('should format an assistant message', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'Hello!',
          name: 'User',
        },
        {
          role: 'assistant',
          content: 'Hi there!',
          name: 'Assistant',
        },
      ];

      const result = convertMessagesToInstructString(messages, basicTemplate, 'User', 'Assistant');

      expect(result).toBe('<|im_start|>user\nHello!<|im_end|>\n<|im_start|>assistant\nHi there!<|im_end|>\n');
    });

    it('should add output sequence when last message is user', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'What is the weather?',
          name: 'User',
        },
      ];

      const result = convertMessagesToInstructString(messages, basicTemplate, 'User', 'Assistant');

      expect(result).toContain('<|im_start|>assistant\n');
    });
  });

  describe('continuation mode', () => {
    it('should skip suffix for last assistant message in continuation mode', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'Tell me a story',
          name: 'User',
        },
        {
          role: 'assistant',
          content: 'Once upon a time',
          name: 'Assistant',
        },
      ];

      const result = convertMessagesToInstructString(messages, basicTemplate, 'User', 'Assistant', true);

      expect(result).toBe('<|im_start|>user\nTell me a story<|im_end|>\n<|im_start|>assistant\nOnce upon a time');
      expect(result).not.toContain('<|im_end|>\n<|im_start|>assistant\nOnce upon a time<|im_end|>');
    });

    it('should not skip suffix for last assistant message when not in continuation mode', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'Tell me a story',
          name: 'User',
        },
        {
          role: 'assistant',
          content: 'Once upon a time',
          name: 'Assistant',
        },
      ];

      const result = convertMessagesToInstructString(messages, basicTemplate, 'User', 'Assistant', false);

      expect(result).toBe(
        '<|im_start|>user\nTell me a story<|im_end|>\n<|im_start|>assistant\nOnce upon a time<|im_end|>\n',
      );
    });

    it('should only skip suffix for assistant messages in continuation mode', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'assistant',
          content: 'Hello',
          name: 'Assistant',
        },
        {
          role: 'user',
          content: 'Hi',
          name: 'User',
        },
      ];

      const result = convertMessagesToInstructString(messages, basicTemplate, 'User', 'Assistant', true);

      // User is last, not assistant, so continuation mode should add output sequence
      expect(result).toContain('<|im_start|>assistant\n');
      expect(result).toContain('<|im_end|>\n<|im_start|>user\nHi<|im_end|>\n');
    });
  });

  describe('names behavior', () => {
    const templateWithNames: InstructTemplate = {
      ...basicTemplate,
      names_behavior: NamesBehavior.INCLUDE,
    };

    it('should add names when names_behavior is INCLUDE', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'Hello!',
          name: 'User',
        },
        {
          role: 'assistant',
          content: 'Hi there!',
          name: 'Assistant',
        },
      ];

      const result = convertMessagesToInstructString(messages, templateWithNames, 'John', 'Bot');

      expect(result).toContain('John: Hello!');
      expect(result).toContain('Bot: Hi there!');
    });

    it('should not add names to system messages even with INCLUDE', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'system',
          content: 'You are helpful.',
          name: 'System',
        },
      ];

      const result = convertMessagesToInstructString(messages, templateWithNames, 'John', 'Bot');

      expect(result).not.toContain('System:');
      // When last message is not assistant, output sequence is added with names
      expect(result).toBe('<|im_start|>system\nYou are helpful.<|im_end|>\n<|im_start|>assistant\nBot: ');
    });

    it('should add names when names_behavior is FORCE', () => {
      const templateForce: InstructTemplate = {
        ...basicTemplate,
        names_behavior: NamesBehavior.FORCE,
      };

      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'Hello!',
          name: 'User',
        },
      ];

      const result = convertMessagesToInstructString(messages, templateForce, 'Alice', 'Bot');

      expect(result).toContain('Alice: Hello!');
    });

    it('should add names when names_behavior is ALWAYS', () => {
      const templateAlways: InstructTemplate = {
        ...basicTemplate,
        names_behavior: NamesBehavior.ALWAYS,
      };

      const messages: ApiChatMessage[] = [
        {
          role: 'assistant',
          content: 'Greetings!',
          name: 'Bot',
        },
      ];

      const result = convertMessagesToInstructString(messages, templateAlways, 'User', 'Charlie');

      expect(result).toContain('Charlie: Greetings!');
    });

    it('should add character name to output sequence with names behavior', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'Hello!',
          name: 'User',
        },
      ];

      const result = convertMessagesToInstructString(messages, templateWithNames, 'John', 'Bot');

      expect(result).toContain('<|im_start|>assistant\nBot: ');
    });
  });

  describe('template placeholder replacement', () => {
    const templateWithPlaceholders: InstructTemplate = {
      ...basicTemplate,
      input_sequence: '<|im_start|>{{user}}\n',
      output_sequence: '<|im_start|>{{char}}\n',
      system_sequence: '<|im_start|>system\n',
    };

    it('should replace {{user}} and {{char}} placeholders', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'Hello',
          name: 'User',
        },
        {
          role: 'assistant',
          content: 'Hi',
          name: 'Assistant',
        },
      ];

      const result = convertMessagesToInstructString(messages, templateWithPlaceholders, 'Alice', 'Bob');

      expect(result).toContain('<|im_start|>Alice\n');
      expect(result).toContain('<|im_start|>Bob\n');
    });

    it('should replace {{name}} placeholder based on role', () => {
      const templateWithName: InstructTemplate = {
        ...basicTemplate,
        input_sequence: '{{name}}: ',
        output_sequence: '{{name}}: ',
      };

      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'Hello',
          name: 'User',
        },
        {
          role: 'assistant',
          content: 'Hi',
          name: 'Assistant',
        },
      ];

      const result = convertMessagesToInstructString(messages, templateWithName, 'John', 'Charlie');

      expect(result).toContain('John: Hello');
      expect(result).toContain('Charlie: Hi');
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple messages with different roles', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'system',
          content: 'Be helpful.',
          name: 'System',
        },
        {
          role: 'user',
          content: 'Question 1',
          name: 'User',
        },
        {
          role: 'assistant',
          content: 'Answer 1',
          name: 'Assistant',
        },
        {
          role: 'user',
          content: 'Question 2',
          name: 'User',
        },
      ];

      const result = convertMessagesToInstructString(messages, basicTemplate, 'User', 'Bot');

      expect(result).toContain('<|im_start|>system\nBe helpful.<|im_end|>');
      expect(result).toContain('<|im_start|>user\nQuestion 1<|im_end|>');
      expect(result).toContain('<|im_start|>assistant\nAnswer 1<|im_end|>');
      expect(result).toContain('<|im_start|>user\nQuestion 2<|im_end|>');
      expect(result).toContain('<|im_start|>assistant\n');
    });

    it('should handle empty content gracefully', () => {
      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: '',
          name: 'User',
        },
        {
          role: 'user',
          content: 'Hello',
          name: 'User',
        },
      ];

      const result = convertMessagesToInstructString(messages, basicTemplate, 'User', 'Assistant');

      // Empty content should be skipped
      expect(result).toBe('<|im_start|>user\nHello<|im_end|>\n<|im_start|>assistant\n');
    });

    it('should handle continuation with names behavior', () => {
      const templateWithNames: InstructTemplate = {
        ...basicTemplate,
        names_behavior: NamesBehavior.INCLUDE,
      };

      const messages: ApiChatMessage[] = [
        {
          role: 'user',
          content: 'Tell me a story',
          name: 'User',
        },
        {
          role: 'assistant',
          content: 'Once upon a time:',
          name: 'Assistant',
        },
      ];

      const result = convertMessagesToInstructString(messages, templateWithNames, 'John', 'Storyteller', true);

      expect(result).toBe(
        '<|im_start|>user\nJohn: Tell me a story<|im_end|>\n<|im_start|>assistant\nStoryteller: Once upon a time:',
      );
      expect(result).not.toContain('<|im_end|>\n<|im_start|>assistant\nStoryteller: Once upon a time:<|im_end|>');
    });
  });
});
