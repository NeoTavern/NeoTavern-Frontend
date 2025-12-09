import type { I18nKey } from './i18n';

export interface ThemeVariables {
  // Colors
  '--theme-text-color': string;
  '--theme-emphasis-color': string;
  '--theme-underline-color': string;
  '--theme-quote-color': string;
  '--theme-background-tint': string;
  '--theme-chat-tint': string;
  '--theme-user-message-tint': string;
  '--theme-bot-message-tint': string;
  '--theme-shadow-color': string;
  '--theme-border-color': string;

  // Accents
  '--color-accent-red': string;
  '--color-accent-green': string;
  '--color-warning': string;
  '--color-error-crimson': string;

  // Scrollbar
  '--scrollbar-width': string;
  '--scrollbar-thumb-color': string;
  '--scrollbar-track-color': string;
  '--scrollbar-thumb-radius': string;
  '--scrollbar-track-radius': string;
  '--scrollbar-thumb-border-width': string;
  '--scrollbar-thumb-shadow-color': string;

  // Typography & Sizing
  '--font-size-main': string;
  '--font-family-main': string;
  '--font-family-mono': string;
  '--base-border-radius': string;
  '--blur-strength': string;
  '--shadow-width': string;

  // Layout
  '--panel-width': string;
  '--sidebar-width': string;

  // Avatars
  '--avatar-width': string;
  '--avatar-height': string;
  '--avatar-border-radius': string;
}

export interface Theme {
  isSystem?: boolean;
  variables: Partial<ThemeVariables>;
}

export const THEME_CATEGORIES: Record<string, (keyof ThemeVariables)[]> = {
  Colors: [
    '--theme-text-color',
    '--theme-emphasis-color',
    '--theme-background-tint',
    '--theme-chat-tint',
    '--theme-user-message-tint',
    '--theme-bot-message-tint',
    '--theme-shadow-color',
    '--theme-border-color',
  ],
  Accents: [
    '--theme-quote-color',
    '--theme-underline-color',
    '--color-accent-red',
    '--color-accent-green',
    '--color-warning',
    '--color-error-crimson',
  ],
  Typography: ['--font-family-main', '--font-family-mono', '--font-size-main'],
  Scrollbar: [
    '--scrollbar-width',
    '--scrollbar-thumb-color',
    '--scrollbar-track-color',
    '--scrollbar-thumb-shadow-color',
    '--scrollbar-thumb-radius',
    '--scrollbar-track-radius',
    '--scrollbar-thumb-border-width',
  ],
  UI: ['--base-border-radius', '--blur-strength', '--shadow-width', '--panel-width', '--sidebar-width'],
  Avatars: ['--avatar-width', '--avatar-height', '--avatar-border-radius'],
};

export const VARIABLE_LABELS: Record<keyof ThemeVariables, I18nKey> = {
  '--theme-text-color': 'themes.variables.colors.textColor',
  '--theme-emphasis-color': 'themes.variables.colors.emphasisColor',
  '--theme-underline-color': 'themes.variables.colors.underlineColor',
  '--theme-quote-color': 'themes.variables.colors.quoteColor',
  '--theme-background-tint': 'themes.variables.colors.backgroundTint',
  '--theme-chat-tint': 'themes.variables.colors.chatTint',
  '--theme-user-message-tint': 'themes.variables.colors.userMessageTint',
  '--theme-bot-message-tint': 'themes.variables.colors.botMessageTint',
  '--theme-shadow-color': 'themes.variables.colors.shadowColor',
  '--theme-border-color': 'themes.variables.colors.borderColor',
  '--color-accent-red': 'themes.variables.colors.accentRed',
  '--color-accent-green': 'themes.variables.colors.accentGreen',
  '--color-warning': 'themes.variables.colors.warningColor',
  '--color-error-crimson': 'themes.variables.colors.errorColor',

  '--scrollbar-width': 'themes.variables.scrollbar.width',
  '--scrollbar-thumb-color': 'themes.variables.scrollbar.thumbColor',
  '--scrollbar-track-color': 'themes.variables.scrollbar.trackColor',
  '--scrollbar-thumb-radius': 'themes.variables.scrollbar.thumbRadius',
  '--scrollbar-track-radius': 'themes.variables.scrollbar.trackRadius',
  '--scrollbar-thumb-border-width': 'themes.variables.scrollbar.thumbBorderWidth',
  '--scrollbar-thumb-shadow-color': 'themes.variables.scrollbar.thumbShadowColor',

  '--font-size-main': 'themes.variables.typography.fontSize',
  '--font-family-main': 'themes.variables.typography.fontFamily',
  '--font-family-mono': 'themes.variables.typography.fontFamilyMono',
  '--base-border-radius': 'themes.variables.typography.borderRadius',
  '--blur-strength': 'themes.variables.typography.blurStrength',
  '--shadow-width': 'themes.variables.typography.shadowWidth',

  '--panel-width': 'themes.variables.layout.panelWidth',
  '--sidebar-width': 'themes.variables.layout.sidebarWidth',

  '--avatar-width': 'themes.variables.avatars.width',
  '--avatar-height': 'themes.variables.avatars.height',
  '--avatar-border-radius': 'themes.variables.avatars.borderRadius',
};

export const VARIABLE_TYPES: Record<keyof ThemeVariables, 'color' | 'text' | 'number'> = {
  '--theme-text-color': 'color',
  '--theme-emphasis-color': 'color',
  '--theme-underline-color': 'color',
  '--theme-quote-color': 'color',
  '--theme-background-tint': 'color',
  '--theme-chat-tint': 'color',
  '--theme-user-message-tint': 'color',
  '--theme-bot-message-tint': 'color',
  '--theme-shadow-color': 'color',
  '--theme-border-color': 'color',
  '--color-accent-red': 'color',
  '--color-accent-green': 'color',
  '--color-warning': 'color',
  '--color-error-crimson': 'color',

  '--scrollbar-width': 'text',
  '--scrollbar-thumb-color': 'color',
  '--scrollbar-track-color': 'color',
  '--scrollbar-thumb-radius': 'text',
  '--scrollbar-track-radius': 'text',
  '--scrollbar-thumb-border-width': 'text',
  '--scrollbar-thumb-shadow-color': 'color',

  '--font-size-main': 'text',
  '--font-family-main': 'text',
  '--font-family-mono': 'text',
  '--base-border-radius': 'text',
  '--blur-strength': 'number',
  '--shadow-width': 'number',

  '--panel-width': 'text',
  '--sidebar-width': 'text',

  '--avatar-width': 'text',
  '--avatar-height': 'text',
  '--avatar-border-radius': 'text',
};
