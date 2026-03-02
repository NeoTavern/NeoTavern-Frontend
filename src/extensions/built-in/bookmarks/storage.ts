import { isEqual, orderBy, uniqWith } from 'lodash';
import type { ChatMetadata, ExtensionAPI } from '../../../types';
import type { DeepPartial } from '../../../types/utils';
import { BOOKMARKS_KEY } from './manifest';
import type { Bookmark, BookmarkMetadata } from './types';

export class BookmarkManager {

  private api: ExtensionAPI<unknown, BookmarkMetadata, unknown>;

  constructor(api: ExtensionAPI<unknown, BookmarkMetadata, unknown>) {
    this.api = api;
  }

  get length(): number {
    return this.getBookmarks().length;
  }
  
  getBookmarks(): Bookmark[] {
    return this.api.chat.metadata.getReactive()?.extra?.[BOOKMARKS_KEY]?.bookmarks ?? [];
  }

  getBookmarksAndMigrateIfNecessary(): Bookmark[] {
    const metadata = this.api.chat.metadata.getReactive();
    if (!metadata) {
      return [];
    }
    const { bookmarks, metadataUpdate } = _getBookmarksWithMigrationUpdate(metadata);
    if (metadataUpdate) {
      this.api.chat.metadata.update(metadataUpdate);
    }
    return bookmarks;
  }

  addBookmark(bookmark: Bookmark) {
    const bookmarks = [...this.getBookmarks()];  // mutable copy
    bookmarks.push(bookmark);
    this._updateBookmarks(bookmarks);
  }
  
  removeBookmark(bookmark: Bookmark) {
    const bookmarks = [...this.getBookmarks()];  // mutable copy
    const bookmarkIndex = bookmarks.findIndex((b) => b.messageNum === bookmark.messageNum && b.title === bookmark.title);
    if (bookmarkIndex > -1) {
      bookmarks.splice(bookmarkIndex, 1);
      this._updateBookmarks(bookmarks);
    } else {
      throw new Error('Bookmark not found: ' + JSON.stringify(bookmark));
    }
  }
  
  _updateBookmarks(bookmarks: Bookmark[]) {
    this.api.chat.metadata.update({
      extra: {
        [BOOKMARKS_KEY]: { bookmarks: bookmarks },
      },
    });
  }
}

export function _getBookmarksWithMigrationUpdate(metadata: ChatMetadata<BookmarkMetadata>) {
  const bookmarksMetadata = metadata.extra?.[BOOKMARKS_KEY];
  const bookmarks: Bookmark[] = [...(bookmarksMetadata?.bookmarks ?? [])];

  let metadataUpdate: DeepPartial<ChatMetadata<BookmarkMetadata>> | null = null;
  const legacy_bookmarks = (metadata as unknown as Record<string, unknown>)?.bookmarks as Bookmark[] | undefined;
  if (legacy_bookmarks) {
    console.log('Legacy bookmarks:', legacy_bookmarks);
    bookmarks.push(...legacy_bookmarks);

    // de-duplicate in case bookmarks exist in both locations
    bookmarks.splice(0, Infinity, ...uniqWith(orderBy(bookmarks, ['messageNum', 'title']), isEqual));

    metadataUpdate = {
      bookmarks: undefined, // Remove legacy bookmarks
      extra: { [BOOKMARKS_KEY]: { bookmarks: bookmarks } },
    } as DeepPartial<ChatMetadata<BookmarkMetadata>>;
  }
  return { bookmarks, metadataUpdate };
}
