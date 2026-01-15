import type { Ref } from 'vue';
import type { ToolInvocation } from './tools';

export interface ChatMediaItem {
  source: 'upload' | 'url' | 'inline';
  type: 'image' | 'video' | 'audio';
  url: string;
  title?: string;
}

export interface ZoomedAvatarTool {
  id: string;
  icon: string;
  title: string;
  onClick: () => void;
}

export interface ZoomedAvatar {
  id: string;
  src: string;
  charName: string;
  tools?: Ref<ZoomedAvatarTool[]> | ZoomedAvatarTool[];
}

export interface ChatMetadata {
  name?: string;
  integrity: string;
  custom_background?: string;
  chat_background?: string;
  chat_lorebooks?: string[];

  members?: string[];
  active_persona?: string;
  connection_profile?: string;

  promptOverrides?: {
    scenario?: string;
  };

  // Extension specific data storage
  extra?: Record<string, unknown>;
}

export interface SwipeInfo {
  send_date: string;
  gen_started?: string;
  gen_finished?: string;
  generation_id?: string;
  extra: {
    reasoning?: string;
    token_count?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } & Record<string, any>;
}

export interface ChatMessage {
  send_date: string;
  name: string;
  mes: string;
  gen_started?: string;
  gen_finished?: string;
  is_user: boolean;
  is_system: boolean; // I think we should rename this
  force_avatar?: string;
  original_avatar: string; // Identifer, which is 'avatar' field in Character
  swipes: string[]; // TODO: I had to make type-safe. But user message shouldn't have swipe stuff though. So we need to tweak this type.
  swipe_info: SwipeInfo[];
  swipe_id: number;
  extra: {
    reasoning?: string;
    reasoning_duration?: number;
    reasoning_type?: string;
    display_text?: string;
    reasoning_display_text?: string;
    token_count?: number;
    media?: ChatMediaItem[];
    ignored_media?: string[];
    tool_invocations?: ToolInvocation[];
    isSmallSys?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } & Record<string, any>;
}

export type ChatHeader = {
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
  file_size: string; // human-readable size like "10KB"
  chat_items: number;
  mes: string;
  last_mes: string; // ISO timestamp
  chat_metadata: ChatMetadata;
};
