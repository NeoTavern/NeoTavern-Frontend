import type { SettingDefinition } from './types';
import { SendOnEnterOptions, TagImportSetting } from './constants';

export const settingsDefinition: SettingDefinition[] = [
  // --- Character Handling ---
  {
    id: 'character.spoilerFreeMode',
    label: 'settings.power_user.spoiler_free_mode.label',
    description: 'settings.power_user.spoiler_free_mode.description',
    category: 'Character Handling',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },
  {
    id: 'character.worldImportDialog',
    label: 'settings.power_user.world_import_dialog.label',
    description: 'settings.power_user.world_import_dialog.description',
    category: 'Character Handling',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: true,
  },
  {
    id: 'character.tagImportSetting',
    label: 'settings.power_user.tag_import_setting.label',
    description: 'settings.power_user.tag_import_setting.description',
    category: 'Character Handling',
    type: 'enum',
    widget: 'select',
    defaultValue: TagImportSetting.ASK,
    options: [
      { value: TagImportSetting.NONE, label: 'settings.power_user.tag_import_setting.options.none' },
      { value: TagImportSetting.ALL, label: 'settings.power_user.tag_import_setting.options.all' },
      { value: TagImportSetting.ONLY_EXISTING, label: 'settings.power_user.tag_import_setting.options.only_existing' },
      { value: TagImportSetting.ASK, label: 'settings.power_user.tag_import_setting.options.ask' },
    ],
  },

  // --- Chat/Message Handling ---
  {
    id: 'chat.sendOnEnter',
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
    id: 'chat.confirmMessageDelete',
    label: 'settings.power_user.confirm_message_delete.label',
    description: 'settings.power_user.confirm_message_delete.description',
    category: 'Chat/Message Handling',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: true,
  },
  {
    id: 'ui.chat.reasoningCollapsed',
    label: 'settings.ui.chat.reasoning_collapsed.label',
    description: 'settings.ui.chat.reasoning_collapsed.description',
    category: 'Chat/Message Handling',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },

  // --- UI & Display ---
  {
    id: 'ui.avatars.zoomedMagnification',
    label: 'settings.power_user.zoomed_avatar_magnification.label',
    description: 'settings.power_user.zoomed_avatar_magnification.description',
    category: 'UI & Display',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: true,
  },
  {
    id: 'ui.avatars.neverResize',
    label: 'settings.power_user.never_resize_avatars.label',
    description: 'settings.power_user.never_resize_avatars.description',
    category: 'UI & Display',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },

  // --- Appearance ---
  {
    id: 'ui.background.thumbnailColumns',
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
    id: 'ui.background.animation',
    label: 'settings.background.animation.label',
    description: 'settings.background.animation.description',
    category: 'Appearance',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },

  // --- Persona ---
  {
    id: 'persona.showNotifications',
    label: 'settings.power_user.persona_show_notifications.label',
    description: 'settings.power_user.persona_show_notifications.description',
    category: 'Persona',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: true,
  },
  {
    id: 'persona.allowMultiConnections',
    label: 'settings.power_user.persona_allow_multi_connections.label',
    description: 'settings.power_user.persona_allow_multi_connections.description',
    category: 'Persona',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },
  {
    id: 'persona.autoLock',
    label: 'settings.power_user.persona_auto_lock.label',
    description: 'settings.power_user.persona_auto_lock.description',
    category: 'Persona',
    type: 'boolean',
    widget: 'checkbox',
    defaultValue: false,
  },
];
