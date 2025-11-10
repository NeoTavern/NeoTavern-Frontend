export const SendOnEnterOptions = {
  DISABLED: -1,
  AUTO: 0,
  ENABLED: 1,
} as const;

export const DebounceTimeout = {
  QUICK: 100,
  SHORT: 200,
  STANDARD: 300,
  RELAXED: 1000,
  EXTENDED: 5000,
} as const;

export const RegexPlacement = {
  /**
   * @deprecated MD Display is deprecated. Do not use.
   */
  MD_DISPLAY: 0,
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  // 4 - sendAs (legacy)
  WORLD_INFO: 5,
  REASONING: 6,
} as const;

export const TAG_FOLDER_TYPES = {
  OPEN: {
    icon: '✔',
    class: 'folder_open',
    fa_icon: 'fa-folder-open',
    tooltip: 'Open Folder (Show all characters even if not selected)',
    color: 'green',
    size: '1',
  },
  CLOSED: {
    icon: '👁',
    class: 'folder_closed',
    fa_icon: 'fa-eye-slash',
    tooltip: 'Closed Folder (Hide all characters unless selected)',
    color: 'lightgoldenrodyellow',
    size: '0.7',
  },
  NONE: { icon: '✕', class: 'no_folder', tooltip: 'No Folder', color: 'red', size: '1' },
} as const;

export const DEFAULT_SAVE_EDIT_TIMEOUT = DebounceTimeout.RELAXED;
export const default_avatar = 'img/ai4.png';
export const ANIMATION_DURATION_DEFAULT = 125;
export let animation_duration = ANIMATION_DURATION_DEFAULT;
export let animation_easing = 'ease-in-out';
export const talkativeness_default = 0.5;
export const depth_prompt_depth_default = 4;
export const depth_prompt_role_default = 'system';
