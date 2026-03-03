import { markRaw } from 'vue';
import type { ExtensionAPI } from '../../../types';
import CurrentBookmarks from './CurrentBookmarks.vue';
import { manifest } from './manifest';
import { BookmarkManager } from './storage';
import type { Bookmark, BookmarkMetadata } from './types';

export { manifest };

export function activate(api: ExtensionAPI<unknown, BookmarkMetadata, unknown>) {
  const unbinds: Array<() => void> = [];
  const t = api.i18n.t;
  /** TODO: Figure out how we're supposed to handle a reactive view of bookmarks.
      api.chat.metadata.get() returns a clone, and it's not obvious to me what impact that has on
      change tracking.

      Options:
      - Rely on metadata.get() returning a clone, and experiment to find if
          a. we do in fact see updates when the original object is updated, and
          b. how many excess copies and re-renders that costs.
      - Fix metadata.get() to return a reactive object.
        - See https://github.com/NeoTavern/NeoTavern-Frontend/pull/103 for some related discussion
          on the ExtensionAPI's data copying habits.
        - (potentially readonly? though there's not much point to restrict it to readonly as long
          as the unrestricted .set and .update methods exist)
      - Decide chat.metadata is not the sole source of truth for bookmark state. Keep our own
        store and when it changes, also write back to metadata.
        - That creates the possibility they get out of sync if anything else is writing to
          chat metadata. There is currently no event emitted on metadata change.
  */

  const bookmarkManager = new BookmarkManager(api);

  unbinds.push(
    api.events.on('chat:entered', () => {
      const bookmarks: Bookmark[] = bookmarkManager.getBookmarksAndMigrateIfNecessary();

      for (const bookmark of bookmarks) {
        console.log('Bookmark:', bookmark.messageNum, bookmark.title);
      }
    }),
  );

  // unbinds.push(
  //   api.events.on('chat:cleared', () => {
  //     currentBookmarks.splice(0, Infinity);
  //   }),
  // );

  // Only works on the right, not the left?
  api.ui.registerSidebar('bookmarks-sidebar', CurrentBookmarks, 'right', {
    title: t('extensionsBuiltin.bookmarks.sidebarTitle'),
    icon: 'fa-solid fa-bookmark',
    props: { api: markRaw(api), bookmarkManager },
  });

  return () => {
    unbinds.forEach((u) => u());
    api.ui.unregisterSidebar('bookmarks-sidebar', 'right');
  };
}
