import type { ApiChatMessage } from '../types/generation';
import { NamesBehavior, type InstructTemplate } from '../types/instruct';

export function convertMessagesToInstructString(
  messages: ApiChatMessage[],
  instruct: InstructTemplate,
  user: string,
  char: string,
  isContinuation = false,
): string {
  const formattedParts: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const isLastMessage = i === messages.length - 1;
    let content = message.content;
    if (!content) continue;

    // Get sequence and suffix based on role
    let sequence = '';
    let suffix = '';

    if (message.role === 'system') {
      sequence = instruct.system_sequence;
      suffix = instruct.system_suffix || '';
    } else if (message.role === 'user') {
      sequence = instruct.input_sequence;
      suffix = instruct.input_suffix || '';
    } else if (message.role === 'assistant') {
      sequence = instruct.output_sequence;
      suffix = instruct.output_suffix || '';
    }

    // Resolve any names behavior templates in sequence/suffix
    // Note: 'names_behavior' usually adds "Name: " to the content, or relies on template placeholders.
    // The Python reference suggests modifying the content directly for INCLUDE/FORCE behavior.

    if (
      instruct.names_behavior === NamesBehavior.INCLUDE ||
      instruct.names_behavior === NamesBehavior.FORCE ||
      instruct.names_behavior === NamesBehavior.ALWAYS
    ) {
      if (message.role !== 'system') {
        let name = '';
        if (message.role === 'user') {
          name = user; // Or '{{user}}' if not resolved yet, but we have the values here
        } else if (message.role === 'assistant') {
          name = char; // Or '{{char}}'
        }

        // If the sequence doesn't already look like it includes the name (heuristics can be tricky),
        // we might prepend it. However, the reference logic for INCLUDE checks if role != system.
        // It prepends "{name}: " to the message content.

        // Only apply if the template assumes we inject names manually (e.g. ChatML usually does NOT, it uses sequences)
        // But for "Text completion" standard presets (like Vicuna), names are often part of the text.

        // The Python logic:
        // if names_behavior == INCLUDE and role != system:
        //   content = f"{name}: {content}"

        // We will stick to the Python reference logic, but using actual values.
        content = `${name}: ${content}`;
      }
    }

    // Replace {{name}}, {{user}}, {{char}} in sequence and suffix
    const replacements: Record<string, string> = {
      '{{name}}': message.role === 'user' ? user : char,
      '{{user}}': user,
      '{{char}}': char,
    };

    for (const [key, value] of Object.entries(replacements)) {
      sequence = sequence.replaceAll(key, value);
      suffix = suffix.replaceAll(key, value);
    }

    // Don't add suffix to last assistant message if it's a continuation
    const skipSuffix = isContinuation && isLastMessage && message.role === 'assistant';
    formattedParts.push(`${sequence}${content}${skipSuffix ? '' : suffix}`);
  }

  // Join all parts
  let finalPrompt = formattedParts.join('');

  // Handle the "start generation" sequence for the assistant
  if (messages.length > 0 && messages[messages.length - 1].role !== 'assistant') {
    let outputSeq = instruct.output_sequence;
    outputSeq = outputSeq.replaceAll('{{name}}', char).replaceAll('{{char}}', char).replaceAll('{{user}}', user);
    finalPrompt += outputSeq;

    if (
      instruct.names_behavior === NamesBehavior.INCLUDE ||
      instruct.names_behavior === NamesBehavior.FORCE ||
      instruct.names_behavior === NamesBehavior.ALWAYS
    ) {
      finalPrompt += `${char}: `;
    }
  }

  return finalPrompt;
}

export function trimInstructResponse(message: string, instructPreset?: InstructTemplate): string {
  let result = message;

  // Generic trim of trailing whitespace
  result = result.replace(/[^\S\r\n]+$/gm, '');

  if (!instructPreset) return result;

  // Trim sequences if they appear at the end or inside (mimicking stop sequences)
  const sequencesToTrim = [
    instructPreset.stop_sequence,
    instructPreset.input_sequence,
    instructPreset.system_sequence, // Sometimes models hallucinate system start
  ];

  for (const seq of sequencesToTrim) {
    if (!seq || !seq.trim()) continue;

    // Check if the exact sequence exists
    const index = result.indexOf(seq);
    if (index !== -1) {
      result = result.substring(0, index);
    }
  }

  // Handle output sequences and potential splitting
  const outputSequences = [instructPreset.output_sequence, instructPreset.last_output_sequence];

  for (const seq of outputSequences) {
    if (!seq) continue;
    // Split by newline to handle multi-line sequences if any, removing them line by line is safer
    // based on the reference logic:
    // sequences.split('\n').forEach(line => message = message.replaceAll(line, ''))

    const lines = seq.split('\n').filter((line) => line.trim() !== '');
    for (const line of lines) {
      result = result.replaceAll(line, '');
    }
  }

  return result;
}
