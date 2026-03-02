import { describe, expect, it } from 'vitest';
import type { ChatMetadata } from '../../../../types';
import { BOOKMARKS_KEY } from '../manifest';
import { _getBookmarksWithMigrationUpdate } from '../storage';
import type { Bookmark, BookmarkMetadata } from '../types';

function metadata(
  overrides: Partial<ChatMetadata<BookmarkMetadata>> & { integrity?: string },
): ChatMetadata<BookmarkMetadata> {
  return {
    integrity: '0123456789',
    ...overrides,
  } as ChatMetadata<BookmarkMetadata>;
}

describe('getBookmarksWithMigrationUpdate', () => {
  it('returns empty bookmarks and null metadataUpdate when metadata has no bookmarks', () => {
    const meta = metadata({});
    const { bookmarks, metadataUpdate } = _getBookmarksWithMigrationUpdate(meta);
    expect(bookmarks).toEqual([]);
    expect(metadataUpdate).toBeNull();
  });

  it('returns bookmarks from extra[BOOKMARKS_KEY] and null metadataUpdate when only new format exists', () => {
    const b: Bookmark[] = [
      { messageNum: 1, title: 'First' },
      { messageNum: 2, title: 'Second' },
    ];
    const meta = metadata({
      extra: { [BOOKMARKS_KEY]: { bookmarks: b } },
    });
    const { bookmarks, metadataUpdate } = _getBookmarksWithMigrationUpdate(meta);
    expect(bookmarks).toEqual(b);
    expect(metadataUpdate).toBeNull();
  });

  it('returns bookmarks from legacy .bookmarks and sets metadataUpdate to migrate to extra', () => {
    const legacy: Bookmark[] = [
      { messageNum: 2, title: 'B' },
      { messageNum: 1, title: 'A' },
    ];
    const meta = metadata({
      ...({ bookmarks: legacy } as unknown as Record<string, unknown>),
    });
    const { bookmarks, metadataUpdate } = _getBookmarksWithMigrationUpdate(meta);
    expect(bookmarks).toHaveLength(2);
    expect(bookmarks).toEqual([
      { messageNum: 1, title: 'A' },
      { messageNum: 2, title: 'B' },
    ]);
    expect(metadataUpdate).not.toBeNull();
    expect(metadataUpdate?.extra?.[BOOKMARKS_KEY]).toEqual({ bookmarks });
    expect((metadataUpdate as Record<string, unknown>)?.bookmarks).toBeUndefined();
  });

  it('merges legacy and extra bookmarks and deduplicates by messageNum and title', () => {
    const extraBookmarks: Bookmark[] = [
      { messageNum: 1, title: 'First' },
      { messageNum: 3, title: 'Third' },
    ];
    const legacyBookmarks: Bookmark[] = [
      { messageNum: 2, title: 'Second' },
      { messageNum: 1, title: 'First' },
    ];
    const meta = metadata({
      extra: { [BOOKMARKS_KEY]: { bookmarks: extraBookmarks } },
      ...({ bookmarks: legacyBookmarks } as unknown as Record<string, unknown>),
    });
    const { bookmarks, metadataUpdate } = _getBookmarksWithMigrationUpdate(meta);
    expect(bookmarks).toHaveLength(3);
    expect(bookmarks).toEqual([
      { messageNum: 1, title: 'First' },
      { messageNum: 2, title: 'Second' },
      { messageNum: 3, title: 'Third' },
    ]);
    expect(metadataUpdate).not.toBeNull();
    expect(metadataUpdate?.extra?.[BOOKMARKS_KEY]?.bookmarks).toEqual(bookmarks);
  });

  it('orders by messageNum then title when merging', () => {
    const legacy: Bookmark[] = [
      { messageNum: 2, title: 'Z' },
      { messageNum: 2, title: 'A' },
      { messageNum: 1, title: 'M' },
    ];
    const meta = metadata({
      ...({ bookmarks: legacy } as unknown as Record<string, unknown>),
    });
    const { bookmarks } = _getBookmarksWithMigrationUpdate(meta);
    expect(bookmarks).toEqual([
      { messageNum: 1, title: 'M' },
      { messageNum: 2, title: 'A' },
      { messageNum: 2, title: 'Z' },
    ]);
  });

  it('returns empty bookmarks from extra when extra[BOOKMARKS_KEY] has no bookmarks array', () => {
    const meta = metadata({
      extra: { [BOOKMARKS_KEY]: {} } as Record<string, unknown> & BookmarkMetadata,
    });
    const { bookmarks, metadataUpdate } = _getBookmarksWithMigrationUpdate(meta);
    expect(bookmarks).toEqual([]);
    expect(metadataUpdate).toBeNull();
  });
});
