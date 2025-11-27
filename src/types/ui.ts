import type { Component } from 'vue';
import type { I18nKey } from './i18n';

export interface ZoomedAvatar {
  id: string;
  src: string;
  charName: string;
}

export interface SidebarDefinition {
  id: string;
  component: Component;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentProps?: Record<string, any>;
  title?: string | I18nKey;
  icon?: string;
  layoutId?: string; // Defaults to 'chat'
}

export interface NavBarItemDefinition {
  id: string;
  icon: string;
  title: string;
  component?: Component;
  onClick?: () => void;
  layout?: 'default' | 'wide';
  layoutComponent?: Component;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  layoutProps?: Record<string, any>;
  defaultSidebarId?: string;
  targetSidebarId?: string;
}

export interface CropData {
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
  scaleX: number;
  scaleY: number;
}
