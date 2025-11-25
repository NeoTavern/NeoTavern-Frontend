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
  /**
   * Which main layout this sidebar belongs to (only used for right sidebars).
   * Defaults to 'chat' when not provided.
   */
  layoutId?: string;
}

export type NavBarItemSection = 'main' | 'floating' | 'drawer';

export interface NavBarItemDefinition {
  id: string;
  icon: string;
  title: string;
  component?: Component;
  onClick?: () => void;
  layout?: 'default' | 'wide';
  section?: NavBarItemSection;
  layoutComponent?: Component;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  layoutProps?: Record<string, any>;
  defaultSidebarId?: string;
  targetSidebarId?: string;
}
