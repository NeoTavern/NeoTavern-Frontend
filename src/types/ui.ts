import type { Component } from 'vue';
import type { I18nKey } from './i18n';

export interface ZoomedAvatar {
  id: string; // Unique ID, can be character name or a UUID
  src: string; // Full URL to the image
  charName: string; // To associate with a character
}

export interface SidebarDefinition {
  id: string;
  component: Component;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentProps?: Record<string, any>;
  title?: string | I18nKey;
  icon?: string; // FontAwesome class
}
