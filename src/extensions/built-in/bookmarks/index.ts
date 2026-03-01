import type { ExtensionAPI } from '../../../types';
import { manifest } from './manifest';
import type { Bookmark, BookmarkMetadata } from './types';
import { getBookmarksAndMigrateIfNecessary } from './storage';

export { manifest };

export function activate(api: ExtensionAPI<unknown, BookmarkMetadata, unknown>) {
  console.log('Bookmarks extension activated');
  const unbinds: Array<() => void> = [];

  unbinds.push(api.events.on('chat:entered', (_chatFile) => {
    const bookmarks: Bookmark[] = getBookmarksAndMigrateIfNecessary(api);

    for (const bookmark of bookmarks) {
      console.log('Bookmark:', bookmark.messageNum, bookmark.title);
    }
  }));

  return () => unbinds.forEach((u) => u());
}

