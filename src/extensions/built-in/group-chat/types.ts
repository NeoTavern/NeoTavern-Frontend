export enum GroupReplyStrategy {
  MANUAL = 0,
  NATURAL_ORDER = 1,
  LIST_ORDER = 2,
  POOLED_ORDER = 3,
  LLM_DECISION = 4,
}

export enum GroupGenerationHandlingMode {
  SWAP = 'swap',
  JOIN_EXCLUDE_MUTED = 'join_exclude',
  JOIN_INCLUDE_MUTED = 'join_include',
}

export interface GroupMemberStatus {
  muted: boolean;
}

export interface GroupChatConfig {
  config: {
    replyStrategy: GroupReplyStrategy;
    handlingMode: GroupGenerationHandlingMode;
    allowSelfResponses: boolean;
    autoMode: number; // seconds, 0 = disabled
    decisionPromptTemplate?: string;
    decisionContextSize: number;
    connectionProfile?: string;
  };
  members: Record<string, GroupMemberStatus>;
}
