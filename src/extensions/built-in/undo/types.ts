import { DebounceTimeout } from "../../../public-api";
import type { ExtensionEventMap } from "../../../types";

export const extensionName = 'undo';
export const toastTimeout = 400;

//Debounce duration.
//Needed to prevent redundant saves. https://github.com/SillyTavern/SillyTavern/pull/4819#discussion_r2571515880
export const saveDebounceDuration = DebounceTimeout.SHORT;

export interface ExtensionSettings {
    showUndoButtons: boolean;
    showSaveButtons: boolean;
    maxChatLength: number;
    maxUndoSnapshots: number;
    showToasts: boolean;
    enableCtrlZ: boolean;
    snapshotEvents: Partial<Record<keyof ExtensionEventMap, boolean>>;
}

//All setting changes will emit an event.
export type SettingChangeEvents = {
    [K in keyof ExtensionSettings as `undo:setting:${K}`]: [ExtensionSettings[K]];
};

declare module "../../../types" { 
    export interface ExtensionEventMap extends SettingChangeEvents {
        'undo:snapshot-loaded': [number];
        'undo:snapshot-saved': [number];
    }
}
//Snapshot the chat when a message is modified.
export const snapshotEvents = [
    'message:created', // event_types.MESSAGE_SENT, event_types.MESSAGE_RECEIVED,
    'message:updated', // event_types.MESSAGE_EDITED, event_types.MESSAGE_UPDATED
    'message:deleted', // event_types.MESSAGE_DELETED,
    //There's no equivalent for these events:
    // event_types.MESSAGE_SWIPE_ENDED,
    // event_types.MESSAGE_FILE_EMBEDDED,
    // event_types.MESSAGE_REASONING_EDITED,
    // event_types.MESSAGE_REASONING_DELETED,
    'message:swipe-deleted', // event_types.MESSAGE_SWIPE_DELETED
    //If an event without 'message:' in the name is added, some UI code must be changed.
] as const;

export const DEFAULT_SETTINGS: ExtensionSettings = {
    showUndoButtons: true,
    showSaveButtons: false,
    maxChatLength: 500,
    maxUndoSnapshots: 10000,
    showToasts: true,
    enableCtrlZ: false,
    snapshotEvents: Object.fromEntries(snapshotEvents.map(event => [event, true]))
};