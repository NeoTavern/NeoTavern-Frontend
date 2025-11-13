export enum SendOnEnterOptions {
  DISABLED = -1,
  AUTO = 0,
  ENABLED = 1,
}

export enum DebounceTimeout {
  QUICK = 100,
  SHORT = 200,
  STANDARD = 300,
  RELAXED = 1000,
  EXTENDED = 5000,
}

export const DEFAULT_SAVE_EDIT_TIMEOUT = DebounceTimeout.RELAXED;
export const DEFAULT_PRINT_TIMEOUT = DebounceTimeout.QUICK;
export const default_avatar = 'img/ai4.png';
export const ANIMATION_DURATION_DEFAULT = 125;
export const talkativeness_default = 0.5;
export const depth_prompt_depth_default = 4;
export const depth_prompt_role_default = 'system';
