import { saveChat as apiSaveChat, fetchChat, saveChat } from '../api/chat';
import type { ChatMessage, FullChat } from '../types/chat';

export const chatService = {
  async fetch(filename: string): Promise<FullChat> {
    const response = await fetchChat(filename);
    return response;
  },

  async save(filename: string, chat: FullChat): Promise<void> {
    await apiSaveChat(filename, chat);
  },

  async create(filename: string, chat: FullChat): Promise<void> {
    await saveChat(filename, chat);
  },

  // Helpers to keep store clean from deep object mutation logic if needed
  syncSwipe(message: ChatMessage, swipeIndex: number) {
    if (!message.swipes || !message.swipes[swipeIndex]) return;

    message.swipe_id = swipeIndex;
    message.mes = message.swipes[swipeIndex];

    const swipeInfo = message.swipe_info?.[swipeIndex];
    if (swipeInfo) {
      message.send_date = swipeInfo.send_date;
      message.gen_started = swipeInfo.gen_started;
      message.gen_finished = swipeInfo.gen_finished;
      message.extra = { ...swipeInfo.extra };
    }

    if (message.extra) {
      delete message.extra.display_text;
      delete message.extra.reasoning_display_text;
    }
  },
};
