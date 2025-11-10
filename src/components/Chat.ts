import { activeCharacterIndex, activeCharacterName, characters } from '../stores/character.store';
import {
  chat,
  chatCreateDate,
  chatMetadata,
  activeMessageEditIndex,
  chatSaveTimeout,
  saveMetadataTimeout,
} from '../stores/chat.store';
import { activeGroupId, groups, isGroupGenerating } from '../stores/group.store';
import { isDeleteMode } from '../stores/ui.store';
import { extensionPrompts, itemizedPrompts, loadItemizedPrompts, saveItemizedPrompts } from '../stores/prompt.store';
import { getMessageTimeStamp, humanizedDateTime } from '../utils/date';
import { select_selected_character, unshallowCharacter } from './RightMenu/CharactersBlock';
import { fetchChat } from '../api/chat';
import type { ChatMessage } from '../types';
import { uuidv4 } from '../utils/common';

/**
 * Cancels the debounced chat save if it is currently pending.
 */
export function cancelDebouncedChatSave() {
  const resolvedChatSaveTimeout = chatSaveTimeout.get();
  if (resolvedChatSaveTimeout) {
    console.debug('Debounced chat save cancelled');
    clearTimeout(resolvedChatSaveTimeout);
    chatSaveTimeout.set(null);
  }
}

export function cancelDebouncedMetadataSave() {
  const resolvedSaveMetadataTimeout = saveMetadataTimeout.get();
  if (resolvedSaveMetadataTimeout) {
    console.debug('Debounced metadata save cancelled');
    clearTimeout(resolvedSaveMetadataTimeout);
    saveMetadataTimeout.set(null);
  }
}

export function closeMessageEditor(what: 'message' | 'reasoning' | 'all' = 'all') {
  if (what === 'message' || what === 'all') {
    const resolvedActiveMessageEditIndex = activeMessageEditIndex.get();
    if (resolvedActiveMessageEditIndex !== null) {
      document
        .getElementById('chat')
        ?.querySelectorAll(`.mes[mesid="${resolvedActiveMessageEditIndex}"] .mes_edit_cancel`)
        .forEach((el) => {
          if (el instanceof HTMLElement) {
            el.click();
          }
        });
    }
  }
  if (what === 'reasoning' || what === 'all') {
    document.querySelectorAll('.reasoning_edit_textarea').forEach((el) => {
      const cancelButton = el.closest('.mes')?.querySelector('.mes_reasoning_edit_cancel');
      if (cancelButton instanceof HTMLElement) {
        cancelButton.click();
      }
    });
  }
}

export async function clearChat() {
  cancelDebouncedChatSave();
  cancelDebouncedMetadataSave();
  closeMessageEditor();
  extensionPrompts.set({});
  if (isDeleteMode.get()) {
    document.getElementById('dialogue_del_mes_cancel')?.click();
  }
  // chatElement.children().remove();
  document.getElementById('chat')!.innerHTML = '';
  if (document.querySelectorAll('.zoomed_avatar[forChar]').length) {
    console.debug('saw avatars to remove');
    document.querySelectorAll('.zoomed_avatar[forChar]').forEach((el) => el.remove());
  } else {
    console.debug('saw no avatars');
  }

  await saveItemizedPrompts(getCurrentChatId());
  itemizedPrompts.set([]);
}

export function getCurrentChatId() {
  const resolvedActiveGroupId = activeGroupId.get();
  const resolvedCharacters = characters.get();
  const resolvedActiveCharacterIndex = activeCharacterIndex.get();
  const resolvedGroups = groups.get();
  if (resolvedActiveGroupId !== null) {
    return resolvedGroups.find((x) => x.id == resolvedActiveGroupId)?.chat_id;
  } else if (resolvedActiveCharacterIndex !== null) {
    return resolvedCharacters[resolvedActiveCharacterIndex]?.chat;
  }

  return undefined;
}

export function resetSelectedGroup() {
  activeGroupId.set(null);
  isGroupGenerating.set(false);
}

export async function refreshChat() {
  try {
    const resolvedCharacters = characters.get();
    const resolvedActiveCharacterIndex = activeCharacterIndex.get();
    if (resolvedActiveCharacterIndex === null) {
      throw new Error('No active character selected');
    }

    const activeCharacter = resolvedCharacters[resolvedActiveCharacterIndex];
    await unshallowCharacter(resolvedActiveCharacterIndex);

    const response = await fetchChat(activeCharacter, chatMetadata.get());

    const currentChat = chat.get();
    if (response[0] !== undefined) {
      currentChat.splice(0, currentChat.length, ...response);
      // @ts-ignore
      chatCreateDate.set(currentChat[0]['create_date'] ?? null);
      // @ts-ignore
      chatMetadata.set(currentChat[0]['chat_metadata'] ?? {});

      currentChat.shift();
      chat.set(currentChat);
      // currentChat.forEach(ensureMessageMediaIsArray); // TODO: Implement
    } else {
      chatCreateDate.set(humanizedDateTime());
    }
    const resolvedChatMetadata = chatMetadata.get();
    if (!resolvedChatMetadata['integrity']) {
      resolvedChatMetadata['integrity'] = uuidv4();
    }
    await getChatResult();
    // eventSource.emit('chatLoaded', { detail: { id: this_chid, character: characters[this_chid] } }); // TODO: Implement

    // Focus on the textarea if not already focused on a visible text input
    setTimeout(function () {
      // if ($(document.activeElement).is('input:visible, textarea:visible')) {
      //   return;
      // }
      // $('#send-textarea').trigger('click').trigger('focus');
      if (document.activeElement instanceof HTMLElement) {
        const activeElementTag = document.activeElement.tagName.toLowerCase();
        if (activeElementTag === 'input' || activeElementTag === 'textarea') {
          return;
        }
      }
      const sendTextarea = document.getElementById('send-textarea');
      sendTextarea?.click();
      sendTextarea?.focus();
    }, 200);
  } catch (error) {
    await getChatResult();
    console.log(error);
  }
}

async function getChatResult() {
  const resolvedCharacters = characters.get();
  const resolvedActiveCharacterIndex = activeCharacterIndex.get();
  if (resolvedActiveCharacterIndex === null) {
    throw new Error('No active character selected');
  }

  activeCharacterName.set(resolvedCharacters[resolvedActiveCharacterIndex].name);
  const resolvedChat = chat.get();
  let freshChat = false;
  if (resolvedChat.length === 0) {
    const message = getFirstMessage();
    if (message.mes) {
      resolvedChat.push(message);
      freshChat = true;
    }
    // Make sure the chat appears on the server
    // await saveChatConditional();  TODO: Implement
  }
  await loadItemizedPrompts(getCurrentChatId());
  // await printMessages(); TODO: Implement
  select_selected_character(resolvedActiveCharacterIndex);

  // await eventSource.emit(event_types.CHAT_CHANGED, (getCurrentChatId())); TODO: Implement
  // if (freshChat) await eventSource.emit(event_types.CHAT_CREATED); TODO: Implement

  if (resolvedChat.length === 1) {
    const chat_id = resolvedChat.length - 1;
    // await eventSource.emit(event_types.MESSAGE_RECEIVED, chat_id, 'first_message'); TODO: Implement
    // await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, chat_id, 'first_message'); TODO: Implement
  }
}

function getFirstMessage() {
  const resolvedCharacters = characters.get();
  const resolvedActiveCharacterIndex = activeCharacterIndex.get();
  if (resolvedActiveCharacterIndex === null) {
    throw new Error('No active character selected');
  }

  const resolvedActiveCharacterName = activeCharacterName.get();
  if (!resolvedActiveCharacterName) {
    throw new Error('Active character name is null');
  }
  const firstMes = resolvedCharacters[resolvedActiveCharacterIndex]?.first_mes || '';
  const alternateGreetings = resolvedCharacters[resolvedActiveCharacterIndex]?.data?.alternate_greetings;

  const message = {
    name: resolvedActiveCharacterName,
    is_user: false,
    is_system: false,
    send_date: getMessageTimeStamp(),
    // mes: getRegexedString(firstMes, RegexPlacement.AI_OUTPUT), // TODO: Implement
    mes: firstMes,
    extra: {},
  } as ChatMessage;

  if (Array.isArray(alternateGreetings) && alternateGreetings.length > 0) {
    // const swipes = [message.mes, ...(alternateGreetings.map(greeting => getRegexedString(greeting, RegexPlacement.AI_OUTPUT)))]; // TODO: Implement
    const swipes = [message.mes, ...alternateGreetings];

    if (!message.mes) {
      swipes.shift();
      message.mes = swipes[0];
    }

    message['swipe_id'] = 0;
    message['swipes'] = swipes;
    message['swipe_info'] = swipes.map((_) => ({
      send_date: message.send_date,
      gen_started: void 0,
      gen_finished: void 0,
      extra: {},
    }));
  }

  return message;
}
