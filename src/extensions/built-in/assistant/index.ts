import type { ExtensionAPI } from '../../../types';
import { manifest } from './manifest';
import type { AssistantSettings } from './types';

export { manifest };
export { migrateAssistantSettings as migrateSettings } from './types';

// Entry points (popover, wands, pinned commands) are registered in later M1 sessions.
export function activate(_api: ExtensionAPI<AssistantSettings>) {}
