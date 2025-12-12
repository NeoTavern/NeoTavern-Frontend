import { applyDelta } from './applyDelta.ts'; //applyDelta is not typed.
import { deepClone } from '../../../utils/extensions.ts';
import { toast } from '../../../composables/useToast.ts';
import { isEqual } from 'lodash-es';
import { diff } from 'deep-object-diff'
import { nextTick } from 'vue';
import type { ChatMessage } from '../../../public-api.ts';
import { toastTimeout, type ExtensionSettings } from './types.ts';
import type { ExtensionAPI } from '../../../types';

import { setup } from './ui.ts';
import { manifest } from './manifest.ts';
export { manifest };
export function activate(api: ExtensionAPI<ExtensionSettings>) {
    //Setup is in ui.ts
    return setup(api);
}

export class ChatHistory {
    chatData: ChatMessage[];
    chatHistory: ChatMessage[][]|object[];
    chatHistoryIndex: number;
    indexChat: () => ChatMessage[];
    settings: ExtensionSettings;
    api: ExtensionAPI<ExtensionSettings>;

    /**
     * ChatHistory is meant to store an undo history, it's inefficient for most other purposes.
     * A read or write to the chatHistory scales at O(n) where n="distance from chatHistoryIndex".
     * Here, the offset is always 1.
     * During normal usage, The memory use of chatHistory will be 2*chat, regardless of how many undo history entries are stored.
     * In comparison, storing full copies of the chat would require much higher memory usage (historyLength*chat), but would scale at O(1).
     * Much lower memory use is easily worth the slightly higher read/write time.
     * @param {ChatMessage[]} chatData or ChatTree.
     */
    constructor(chatData: ChatMessage[], settings: ExtensionSettings, api: ExtensionAPI<ExtensionSettings>) {
        //chatTree or chat.
        this.chatData = chatData;
        /** @type {ChatMessage[][]|object[]} Only the chat at indexChat is a chatMessage[], the rest are diffs. */
        this.chatHistory = [];
        /** This should only be set by stepIndex. */
        this.chatHistoryIndex = 0;
        /** @type {() => ChatMessage[]} Chat, or chatTree at the current Index */
        this.indexChat = () => {return this.chatHistory[this.chatHistoryIndex] as ChatMessage[];};
        this.settings = settings;
        this.api = api;
    }
    /**
     * Regenerates the full chat of an adjacent diff.
     * @param {-1|1} offset index -1 or +1.
     * @param {object} [fullChat=this.indexChat()] this.indexChat() by default.
     * @param {number} [fullChatIndex=this.indexChat()] The id of fullChat, chatHistoryIndex by default.
     * @returns {object} The full chat at the offset, or nothing.
     */
    adjacentChat(offset = 1, fullChat = this.indexChat(), fullChatIndex = this.chatHistoryIndex) {
        const offsetId = fullChatIndex + offset;
        const offsetChatDiff = this.chatHistory[offsetId];
        if (typeof(offsetChatDiff) === 'object') {
            return applyDelta(structuredClone(fullChat), structuredClone(offsetChatDiff)) as ChatMessage[];
        }
    }

    /**
     * Steps, moving chatHistoryIndex. forwards or backwards.
     * In chatHistory, the chat at chatHistoryIndex is the only full copy.
     * When chatHistoryIndex moves, the adjacent diffs are recreated on the new index.
     * Returns the chat at offset, if it exists.
     * @param {-1|1} offset index -1 or +1.
     * @param {ChatMessage[]} newChatData This defaults to the chat at offset.
     * @returns {object} The new chat at offset.
     */
    stepIndex(offset = 1, newChatData: ChatMessage[]|undefined = undefined) {

        //The next chat over must also be updated, it's based on the chat that's about to be written.
        const nextChat = this.adjacentChat(offset);
        newChatData ??= nextChat;
        if (typeof(newChatData) !== 'object') {
            //The diffs cannot be based upon nothing.
            throw new Error(`Cannot step! Offset ${offset} from ${this.chatHistoryIndex} cannot be updated if the newChatData doesn't exist.`);
        }


        //The current indexChat will be replaced with it's diff.
        const currentChat = this.indexChat();
        const currentChatDiff = diff(newChatData, currentChat);

        this.chatHistory[this.chatHistoryIndex] = currentChatDiff;

        //This shifts the relative positions. e.g., nextChat is now indexChat, currentChat is now the previous chat..
        this.chatHistoryIndex += offset;

        //If the nextChat (now indexChat) as changed, then it's adjacentChat must be updated.
        if (typeof(nextChat) !== 'undefined' && !(nextChat === newChatData)) {
            //If the offset diff does not exist, this will do nothing.
            this.updateOffset(newChatData, offset, nextChat);
        }
        //Write the newChatData, both diffs are based upon this.
        this.chatHistory[this.chatHistoryIndex] = newChatData;
        return newChatData;
    }

    /**
     * Updates the previous or next chat with the newChatData, if it exists.
     * This does not update chatHistoryIndex or the indexChat.
     * Using this function without updating indexChat leaves the offsetChat ungettable.
     * @param {object} newChatData The offset diffs will be created against newChatData.
     * @param {-1|1} offset index -1 or +1.
     * @param {object} fullChat The full chat that the diff was originally created from.
     * @returns {object} The full chat at the offset, or nothing.
     */
    updateOffset(newChatData: ChatMessage[], offset = 1, fullChat = this.indexChat()) {
        if (typeof(fullChat) !== 'object') {
            throw new Error(`The chat offset ${offset} from ${this.chatHistoryIndex} cannot be updated if the fullChat it was created with does not exist.`);
        }

        //Create the offsetChat from by updating the fullChat with the diff.
        const offsetChat = this.adjacentChat(offset, fullChat);
        if (typeof(offsetChat) === 'object') {
            //Create a diff from the newChatData and offsetChat, overwrite the old diff.
            const updatedPreviousDiff = structuredClone(diff(newChatData, offsetChat));
            this.chatHistory[this.chatHistoryIndex - offset] = updatedPreviousDiff;
            return offsetChat;
        }
    }

    /**
     * Resets chatHistory, and set's the first entry.
     * @param {boolean} showToast toast that the has been cleared.
     */
    async resetChatSnapshots(showToast = true){
        this.chatHistory.length = 0;
        this.chatHistoryIndex = 0;

        this.chatHistory = [deepClone(this.chatData)];
        if (showToast) toast.warning(`You now have ${this.chatHistory.length} snapshots.`, `Success.`, { timeout: toastTimeout, preventDuplicates: true });
    }

    /**
     * Save a copy of chatData to chatHistory to chatHistoryIndex + 1.
     * @param {boolean} showToast toast that the chat has saved.
     */
    async saveChatSnapshot(showToast = false){
        const t1 = performance.now();
        const maxUndoSnapshots = this.settings.maxUndoSnapshots;
        const maxChatLength = this.settings.maxChatLength;


        //Enforce the maximum chat length.
        if (Array.isArray(this.chatData) && this.chatData.length > maxChatLength) {
            if (showToast) toast.error(`It's in 'Extensions > Chat Undo History > Max chat length'`, `You cannot save the chat because it's ${this.chatData.length - maxChatLength} messages longer than your max chat length limit (${maxChatLength}). (Check Settings.)`, { timeout: toastTimeout, preventDuplicates: true });
            return;
        }

        //Max history cannot be less than zero.
        if (0 >= maxUndoSnapshots) {
            if (showToast) toast.error(`It's in 'Extensions > Chat Undo History > Max Undo Snapshots'`, `You cannot save the chat because your Max Undo Snapshots is set to ${maxUndoSnapshots}. (Check Settings.)`, { timeout: toastTimeout, preventDuplicates: true });
            return;
        }

        //Currently a full chat.
        const previousChat = this.indexChat();

        //Only save changed chats.
        if (isEqual(deepClone(this.chatData), previousChat)) {
            if (showToast) toast.warning(`The chat is unchanged. You still have ${this.chatHistory.length} snapshots.`, `Warning.`, { timeout: toastTimeout, preventDuplicates: true });
            return;
        }

        //Overwrite history that has been undone.
        //e.g. If you undo, then start typing, you cannot redo.
        this.chatHistory.splice(this.chatHistoryIndex + 1);

        //Enforce maxChatHistory.
        this.chatHistory.splice(0, this.chatHistory.length - maxUndoSnapshots);

        //Save the full history.
        const currentChat = deepClone(this.chatData);
        //Save the chat, and replace the previous chat with a diff.
        this.stepIndex(1, currentChat);

        if (showToast) toast.success(`You now have ${this.chatHistory.length} snapshots.`, `Success.`, { timeout: toastTimeout, preventDuplicates: true });
        console.debug(`Saved a chat snapshot in ${(performance.now() - t1) / 1000} seconds.`);
    }

    /**
     * Load the previous or next snapshot.
     * @param {-1|1} offset index -1 or +1.
     * @returns
     */
    async loadChatSnapshot(offset: -1|1) {
        const t1 = performance.now();
        const showUndoToast = (this.settings.showToasts);
        const index = this.chatHistoryIndex + offset;
        const maximumChatLength = this.settings.maxChatLength;

        //Don't overwrite chats that are longer than maximumChatLength.
        if (this.chatData.length > maximumChatLength) {
            toast.error(`It's in 'Extensions > Chat Undo History > Max chat length'`, `You cannot load the chat because it's ${this.chatData.length - maximumChatLength} messages longer than your max chat length limit (${maximumChatLength}). (Check Settings.)`, { timeout: toastTimeout, preventDuplicates: true });
            return;
        }

        if (typeof(this.chatHistory[index]) !== 'undefined') {

            //The created/updated/deleted messages will need to be guessed.
            const createdIds: Array<number> = [];
            const updatedIds: Array<number> = [];
            const deletedIds: Array<number> = [];
            const newDiff = this.chatHistory[this.chatHistoryIndex + offset];
            
            const newChat = this.stepIndex(offset);
            const oldChatLength = this.chatData.length;

            //Replace the chat.
            this.chatData.splice(0, oldChatLength, ...newChat);

            //Store the new messages.
            Object.entries(newDiff).forEach(async ([id, messageDiff]) => {
                const messageId = Number(id);
                if (!this.chatData[messageId] && typeof(messageDiff) === 'undefined') deletedIds.push(messageId)
                if (!this.chatData[messageId] && typeof(messageDiff) === 'object') createdIds.push(messageId)
                if (this.chatData[messageId] && typeof(messageDiff) === 'object') updatedIds.push(messageId)
            })

            await this.api.events.emit('undo:snapshot-loaded', index);

            //Emit events
            createdIds.forEach(async (id) => {
                await this.api.events.emit('message:created', this.chatData[id])
            })
            updatedIds.forEach(async (id) => {
                await this.api.events.emit('message:updated', id, this.chatData[id])
            })
            if (deletedIds.length > 0) { await this.api.events.emit('message:deleted', deletedIds);}
            

            await nextTick()
            if (showUndoToast) toast.success(`Snapshot ${this.chatHistoryIndex + 1}/${this.chatHistory.length} has been loaded.`, `Success.`, { timeout: toastTimeout, preventDuplicates: true });

        }
        else {
            if (showUndoToast) toast.error(`Snapshot ${index + 1}/${this.chatHistory.length} does not exist!`, `The snapshot cannot be loaded.`, { timeout: toastTimeout, preventDuplicates: true });
        }
        console.debug(`Loaded a chat snapshot in ${(performance.now() - t1) / 1000} seconds.`);
    }
    async loadPreviousSnapshot() {
        await this.loadChatSnapshot(-1);
    }
    async loadNextSnapshot() {
        await this.loadChatSnapshot(1)
    }
}
