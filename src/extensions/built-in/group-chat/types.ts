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
  SWAP_INCLUDE_SUMMARIES = 'swap_include_summaries',
}

export interface GroupMemberStatus {
  muted: boolean;
  summary?: string;
}

export interface GroupChatConfig {
  config: {
    replyStrategy: GroupReplyStrategy;
    handlingMode: GroupGenerationHandlingMode;
    allowSelfResponses: boolean;
    autoMode: number; // seconds, 0 = disabled
    decisionContextSize: number;
  };
  members: Record<string, GroupMemberStatus>;
}

export interface GroupExtensionSettings {
  defaultDecisionPromptTemplate: string;
  defaultSummaryPromptTemplate: string;
  summaryInjectionTemplate: string;
  defaultConnectionProfile: string;
}
