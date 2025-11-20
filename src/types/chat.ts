export interface ChatMetadata {
  integrity?: string;
  custom_background?: string;
  chat_backgrounds?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface SwipeInfo {
  send_date?: string;
  gen_started?: string;
  gen_finished?: string;
  extra: {
    reasoning?: string;
    token_count?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } & Record<string, any>;
}

export interface ChatMessage {
  send_date?: string;
  name: string;
  mes: string;
  gen_started?: string;
  gen_finished?: string;
  is_user?: boolean;
  is_system?: boolean;
  force_avatar?: string;
  original_avatar?: string;
  swipes?: string[];
  swipe_info?: SwipeInfo[];
  swipe_id?: number;
  extra?: {
    reasoning?: string;
    reasoning_duration?: number;
    reasoning_type?: string;
    display_text?: string;
    reasoning_display_text?: string;
    token_count?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } & Record<string, any>;
}

export type ChatHeader = {
  character_name: string;
  chat_metadata: ChatMetadata;
};

export type FullChat = [ChatHeader, ...ChatMessage[]];

export type ChatInfo = {
  /**
   * File name without extension
   */
  file_id: string;
  /**
   * File name with extension
   */
  file_name: string;
  file_size: number;
  chat_items: number;
  mes: string;
  last_mes: number; // Unix timestamp
  chat_metadata: ChatMetadata;
};
