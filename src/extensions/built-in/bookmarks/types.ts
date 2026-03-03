export const BOOKMARKS_KEY = 'core.bookmarks';

export interface Bookmark {
  messageNum: number;
  title: string;
}

export interface BookmarkMetadata {
  [BOOKMARKS_KEY]?: {
    bookmarks: Bookmark[];
  };
}
