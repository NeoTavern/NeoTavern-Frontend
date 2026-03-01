import { isEqual, orderBy, uniqWith } from 'lodash';
import type { ChatMetadata, ExtensionAPI } from '../../../types';
import type { DeepPartial } from '../../../types/utils';
import { BOOKMARKS_KEY } from './manifest';
import type { Bookmark, BookmarkMetadata } from './types';

export function getBookmarksWithMigrationUpdate(metadata: ChatMetadata<BookmarkMetadata>) {
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


export function getBookmarksAndMigrateIfNecessary(api: ExtensionAPI<unknown, BookmarkMetadata, unknown>) {
    const metadata = api.chat.metadata.get();
    if (!metadata) {
        return [];
    }
    const { bookmarks, metadataUpdate } = getBookmarksWithMigrationUpdate(metadata);
    if (metadataUpdate) {
        api.chat.metadata.update(metadataUpdate);
    }
    return bookmarks;
}
