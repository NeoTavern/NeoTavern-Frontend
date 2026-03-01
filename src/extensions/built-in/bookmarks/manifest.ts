import type { ExtensionManifest } from '../../../types';

export const BOOKMARKS_KEY = 'core.bookmarks';

export const manifest: ExtensionManifest = {
  name: BOOKMARKS_KEY,
  display_name: 'Bookmarks',
  description: 'Add named bookmarks to chat messages.',
  version: '1.0.0',
  author: 'NeoTavern Team',
  icon: 'fa-solid fa-bookmark',
};
