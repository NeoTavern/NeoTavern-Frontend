export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type DrawerType = 'ai-config' | 'world-info' | 'user-settings' | 'extensions' | 'persona' | 'character';
export type ThumbnailType = 'bg' | 'avatar' | 'persona';
export type BackgroundFitting = 'classic' | 'cover' | 'contain' | 'stretch' | 'center';
export type StrictOmitString<T extends string, K extends string> = T extends K ? never : T;
