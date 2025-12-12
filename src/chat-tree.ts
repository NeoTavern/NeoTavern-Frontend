// import { useChatStore } from './stores/chat.store.ts';
import { eventEmitter } from './utils/extensions.ts';

import {
    type ChatMessage,
    type ChatTree,
    type ChatTreeMessage,
} from './types/chat.ts';


/**
 * Saves to the chatTree if it's enabled.
 */
export async function saveToTree(tree: ChatTree, chat: ChatMessage[]){
    //Everything after end will be pruned from the tree.
    const end = chat.length - 1;
    //Save the chat to the chatTree.
    await saveChatToTree(chat, tree, { start:0, end: end });
}
export async function loadFromTree(tree: ChatTree, chat: ChatMessage[], messageId: number, newSwipeId: number) {
    //Get chat after the swipe.
    const stick = await getStick(chat, tree, messageId, newSwipeId);
    
    //When editing user messages, the stick's length is zero.
    //Extensions may exist that alter swipes. Until swipes are deprecated they must be prioritized over the branch.
    //The branch's first message will be discarded until this can be changed.
    stick[0] = chat[messageId];
    stick[0].swipe_id = newSwipeId;

    //Update chat.
    await spliceStickToChat(stick, chat, messageId);
}

/**
 * Save the Chat to the chatTree.
 */
export async function saveChatToTree(chat: ChatMessage[], tree: ChatTree, { start = 0, end = chat.length - 1 } = {}) {

    //Track the current branch
    let branch = tree;

    function addMessage(branch: ChatTreeMessage, branch_id: number, message: ChatTreeMessage)
    {
        if (typeof(branch?.['branch']?.[branch_id]) == 'undefined') {
            branch!['branch']![branch_id] = message;
        } 
        Object.assign(branch!['branch']![branch_id], message);
    }

    const startTime = performance.now();
    const partialChat = chat.slice(0, end + 1);
    // Traverse the tree following the chat's path.
    for (const chatMessage of partialChat) { //This will cause all branches after end to be deleted.
        console.assert(typeof branch !== 'undefined', 'The branch must exist.');

        //Default to the first swipe.
        const branch_id = Number(chatMessage['swipe_id'] ?? 0);
        console.assert(typeof branch_id !== 'undefined', 'The branch_id must exist.');
        branch['branch_id'] = branch_id;

        branch['branch'] ??= [];

        //Save only the messages between start and end.
        if (start <= chat.indexOf(chatMessage)) {

            // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
            const { swipes:_s, swipe_info:_si, swipe_id:_sid, ...swipelessMessage } = { ...chatMessage };

            //There must be at least as many messages as branch_id
            console.assert(branch_id <= (chatMessage['swipes']?.length ?? 0), 'There must be at least as many messages as branch_id');

            //For each swipe, update a branch. This may run zero times.
            chatMessage?.['swipes']?.forEach((swipe, i) => {

                // There must be at least a message for every swipe_info.
                console.assert((chatMessage['swipe_info']?.length ?? 0) <= (chatMessage['swipes']?.length ?? 0), 'There must be at least a message for every swipe_info.');

                //branch = Full Message < swipe_info < Swipe message.
                addMessage(branch as ChatTreeMessage, i, { ...swipelessMessage, ...chatMessage?.swipe_info?.[i], mes: swipe });
            });

            //Set the full message while preserving branches.
            addMessage(branch as ChatTreeMessage, branch_id, { ...swipelessMessage });
        }

        //Follow the branch.
        branch = branch['branch'][branch_id];
    }

    //Prune deleted branch, A branch cannot be empty.
    if (typeof(branch['branch_id']) == 'number') {
        console.log('Pruning deleted branch.', branch);
        delete branch['branch_id'];
        delete branch['branch'];
    }

    const endTime = performance.now();
    console.log(`Saved ${chat.length} messages to chatTree in ${(endTime - startTime) / 1000} seconds`);
}

/**
 * Returns the chat after a given index, following swipe_id.
 */
export async function getStick(chat: ChatMessage[], tree: ChatTree, index: number, newSwipeId: number|undefined) {

    //Accumulates messages.
    const stick = [];

    //Track current branch
    let branch = tree;

    // Traverse the tree following the chat's path.

    let i = 0;
    while (branch['branch'] && branch['branch']?.length  >= 1) {

        //Follow messages's swipe_id before index, then the branch's branch_id, then the first swipe.
        const branch_id = Number((
            (newSwipeId && i == index) ? newSwipeId :
            (i <= index) ? chat[i]?.['swipe_id'] : branch?.['branch_id']
        ) ?? 0);

        //If the branch exists.
        if (branch['branch']?.[branch_id]) {

            //Add all messages after index to chatBranch.
            if (i >= index) {

                //Push the message without it's branches.

                // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
                const { branch: _b, branch_id: _bi, ...message } = branch['branch'][branch_id];
                //Decompress swipe.
                const newMessage = Object.assign({}, message, {
                    swipes: branch['branch'].map((m) => m.mes),
                    swipe_id: branch_id,
                    swipe_info: branch['branch'].map((m) =>
                    {
                        return {
                            'send_date': m['send_date'],
                            'gen_started': m['gen_started'],
                            'gen_finished': m['gen_finished'],
                            'extra': m['extra'],
                        };
                    })
                })

                stick.push(newMessage as ChatMessage);
            }

            //Follow the branch.
            branch = branch['branch'][branch_id];
            i++;
        }
        else {
            console.warn(`The expected branch #${branch_id} does not exist.`, branch);
            break;
        }
    }
    return stick;
}

/**
 * If a swipe is deleted, remove it's branch from the tree.
 */
// eventEmitter.on('message:swipe-deleted', async ({ messageIndex, swipeIndex, newSwipeId }) => {
//     const chatStore = useChatStore();
//     const chat = chatStore.activeChat?.messages;
//     const tree = chatStore.activeChat?.tree;
//     if (typeof tree == 'undefined') return;
//     if (chat) await deleteBranch(chat, tree, messageIndex, swipeIndex, newSwipeId);
// });

/**
 * Deletes a branch if it exists.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deleteBranch(chat: ChatMessage[], tree: ChatTree, mesId: number, swipeId: number, newSwipeId: number) {

    //Track current branch
    let branch = tree;

    let i = 0;
    while (branch['branch'] && branch['branch']?.length  >= 1) {

        //Follow messages's swipe_id, then the first swipe.
        const branch_id = Number(chat[i]?.['swipe_id'] ?? 0);

        //If the branch exists.
        if (branch['branch']?.[branch_id]) {

            //Add all messages after index to chatBranch.
            if (i == mesId) {

                console.log(`Deleting branch #${swipeId} at depth ${i}`, branch['branch'][swipeId]);
                branch['branch'].splice(swipeId, 1);
                branch['branch_id'] = newSwipeId;
                break;
            }

            //Follow the branch.
            branch = branch['branch'][branch_id];
            i++;
        }
        else {
            console.warn(`The expected branch #${branch_id} does not exist.`, branch);
            break;
        }
    }
}

/**
 * Splices a branch into the chat.
 * @param {Array} stick
 * @param {Array} chat
 * @param {number} index
 */
export async function spliceStickToChat(stick: ChatMessage[], chat: ChatMessage[], index = 0) {
    //This will break references after index.
    // const deleted = 
    chat.splice(index, chat.length - index, ...stick);

    await eventEmitter.emit('message:deleted', [1]);
}