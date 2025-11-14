import type { SettingDefinition } from './types';
import { SendOnEnterOptions } from './constants';

export const settingsDefinition: SettingDefinition[] = [
  // --- Character Handling ---
  {
    id: 'power_user.spoiler_free_mode',
    label: 'settings.power_user.spoiler_free_mode.label',
    description: 'settings.power_user.spoiler_free_mode.description',
    category: 'Character Handling',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },
  {
    id: 'power_user.never_resize_avatars',
    label: 'settings.power_user.never_resize_avatars.label',
    description: 'settings.power_user.never_resize_avatars.description',
    category: 'Character Handling',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },
  {
    id: 'power_user.world_import_dialog',
    label: 'settings.power_user.world_import_dialog.label',
    description: 'settings.power_user.world_import_dialog.description',
    category: 'Character Handling',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: true,
  },

  // --- Chat/Message Handling ---
  {
    id: 'power_user.send_on_enter',
    label: 'settings.power_user.send_on_enter.label',
    description: 'settings.power_user.send_on_enter.description',
    category: 'Chat/Message Handling',
    type: 'enum',
    widget: 'select',
    defaultValue: SendOnEnterOptions.AUTO,
    options: [
      { value: SendOnEnterOptions.DISABLED, label: 'settings.power_user.send_on_enter.options.disabled' },
      { value: SendOnEnterOptions.AUTO, label: 'settings.power_user.send_on_enter.options.auto' },
      { value: SendOnEnterOptions.ENABLED, label: 'settings.power_user.send_on_enter.options.enabled' },
    ],
  },
  {
    id: 'power_user.auto_fix_generated_markdown',
    label: 'settings.power_user.auto_fix_generated_markdown.label',
    description: 'settings.power_user.auto_fix_generated_markdown.description',
    category: 'Chat/Message Handling',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },
  {
    id: 'power_user.confirm_message_delete',
    label: 'settings.power_user.confirm_message_delete.label',
    description: 'settings.power_user.confirm_message_delete.description',
    category: 'Chat/Message Handling',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: true,
  },
  {
    id: 'power_user.movingUI',
    label: 'settings.power_user.movingUI.label',
    description: 'settings.power_user.movingUI.description',
    category: 'UI & Display',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },
  {
    id: 'power_user.zoomed_avatar_magnification',
    label: 'settings.power_user.zoomed_avatar_magnification.label',
    description: 'settings.power_user.zoomed_avatar_magnification.description',
    category: 'UI & Display',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: true,
  },

  // --- Appearance ---
  {
    id: 'background.thumbnailColumns',
    label: 'settings.background.thumbnailColumns.label',
    description: 'settings.background.thumbnailColumns.description',
    category: 'Appearance',
    type: 'number',
    widget: 'slider',
    defaultValue: 5,
    min: 2,
    max: 8,
    step: 1,
  },
  {
    id: 'background.animation',
    label: 'settings.background.animation.label',
    description: 'settings.background.animation.description',
    category: 'Appearance',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },
];
