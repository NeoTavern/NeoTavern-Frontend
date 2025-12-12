<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { usePopupStore } from '../../stores/popup.store';
import { useSecretStore } from '../../stores/secret.store';
import { useSettingsStore } from '../../stores/settings.store';
import type { AiConfigItem, AiConfigValueItem, ApiProvider } from '../../types';
import type { I18nKey } from '../../types/i18n';
import { DraggableList } from '../common';
import SecretManagerPopup from '../Secrets/SecretManager.vue';
import {
  Button,
  Checkbox,
  CollapsibleSection,
  FormItem,
  Input,
  ListItem,
  RangeControl,
  Select,
  Textarea,
  Toggle,
} from '../UI';
import ModelSelect from './ModelSelect.vue';
import PresetManager from './PresetManager.vue';

const props = defineProps<{
  item: AiConfigItem;
}>();

const settingsStore = useSettingsStore();
const secretStore = useSecretStore();
const popupStore = usePopupStore();
const { t } = useStrictI18n();

// Conditions Check
const isVisible = computed(() => {
  if (!props.item.conditions) return true;
  const conditionsList = Array.isArray(props.item.conditions) ? props.item.conditions : [props.item.conditions];

  // OR Logic: If ANY condition object in the list matches, return true.
  return conditionsList.some((cond) => {
    // AND Logic within object
    const { provider, formatter } = cond;

    if (provider) {
      const providers = Array.isArray(provider) ? provider : [provider];
      const current = settingsStore.settings.api.provider;
      if (!current || !providers.includes(current)) return false;
    }

    if (formatter) {
      const formatters = Array.isArray(formatter) ? formatter : [formatter];
      const current = settingsStore.settings.api.formatter;
      if (!current || !formatters.includes(current)) return false;
    }

    return true;
  });
});

// Group Enable/Disable Logic
function isGroupDisabled(groupId?: string): boolean {
  if (!groupId) return false;
  const provider = settingsStore.settings.api.provider;
  if (!provider) return false;

  const disabledMap = settingsStore.settings.api.samplers.providers.disabled_fields;
  if (!disabledMap) return false;

  const disabledList = disabledMap[provider];
  if (!disabledList) return false;

  return disabledList.includes(groupId);
}

function toggleGroupEnabled(groupId: string, enabled: boolean) {
  const provider = settingsStore.settings.api.provider;
  if (!provider) return;

  const samplers = settingsStore.settings.api.samplers;
  if (!samplers.providers.disabled_fields) {
    samplers.providers.disabled_fields = {};
  }

  const disabledMap = samplers.providers.disabled_fields as Partial<Record<ApiProvider, string[]>>;
  let list = disabledMap[provider] || [];

  if (!enabled) {
    if (!list.includes(groupId)) list.push(groupId);
  } else {
    list = list.filter((id) => id !== groupId);
  }

  disabledMap[provider] = list;
}

// Data Binding with Array handling
const boundValue = computed({
  get: () => {
    const item = props.item as AiConfigValueItem;
    if (!item.id) return undefined;
    const val = settingsStore.getSetting(item.id);

    // If explicit valueType is array, handle conversion to string
    if (item.valueType === 'array' && Array.isArray(val)) {
      const separator = item.arraySeparator || ',';
      return val.join(separator);
    }

    return val;
  },
  set: (val) => {
    const item = props.item as AiConfigValueItem;
    if (!item.id) return;

    // If explicit valueType is array, handle split back to array
    if (item.valueType === 'array' && typeof val === 'string') {
      const separator = item.arraySeparator || ',';
      // Split, map trim, filter boolean
      const newVal = val
        .split(separator)
        .map((s) => s.trim())
        .filter((s) => s !== '');
      settingsStore.setSetting(item.id, newVal);
    } else {
      settingsStore.setSetting(item.id, val);
    }
  },
});

// Max Unlocked Logic
const maxUnlockedValue = computed({
  get: () => {
    if (props.item.widget !== 'slider' || !props.item.maxUnlockedId) return false;
    return !!settingsStore.getSetting(props.item.maxUnlockedId);
  },
  set: (val) => {
    if (props.item.widget === 'slider' && props.item.maxUnlockedId) {
      settingsStore.setSetting(props.item.maxUnlockedId, val);
    }
  },
});

const maxLimit = computed(() => {
  if (props.item.widget === 'slider' && props.item.maxUnlockedId && maxUnlockedValue.value) {
    return 131072;
  }
  return props.item.widget === 'slider' || props.item.widget === 'number-input' ? props.item.max : undefined;
});

function getOptionLabel(item: AiConfigItem, value: string | number) {
  if (item.widget !== 'draggable-list' && item.widget !== 'select') return value;
  const opt = (item as AiConfigValueItem).options?.find((o) => o.value === value);
  return opt ? t(opt.label as I18nKey) : value;
}

const activeSecretPlaceholder = computed(() => {
  const item = props.item as AiConfigValueItem;
  if (!item.secretKey) return '';
  const active = secretStore.getActiveSecret(item.secretKey);
  // @vue-ignore
  return active ? `${t('secrets.keySaved')} (${active.label})` : t('common.none');
});

function openSecretManager() {
  const item = props.item as AiConfigValueItem;
  if (!item.secretKey) return;
  popupStore.show({
    component: SecretManagerPopup,
    componentProps: { secretKey: item.secretKey },
  });
}
</script>

<template>
  <div v-if="isVisible" class="ai-config-renderer" :class="item.cssClass">
    <!-- Group -->
    <template v-if="item.widget === 'group'">
      <CollapsibleSection :title="item.label ? t(item.label) : ''">
        <template v-if="item.enableable && item.id" #actions>
          <FormItem>
            <Toggle
              :model-value="!isGroupDisabled(item.id)"
              @update:model-value="(val) => toggleGroupEnabled(item.id!, val)"
            />
          </FormItem>
        </template>
        <div :class="{ 'is-disabled-group': item.id && isGroupDisabled(item.id) }">
          <AiConfigItemRenderer v-for="(subItem, idx) in item.items" :key="idx" :item="subItem" class="sub-item" />
        </div>
      </CollapsibleSection>
    </template>

    <!-- Preset Manager -->
    <PresetManager v-else-if="item.widget === 'preset-manager'" :item="item" />

    <!-- Model Select -->
    <FormItem v-else-if="item.widget === 'model-select'" :label="item.label ? t(item.label) : ''">
      <ModelSelect :item="item" />
    </FormItem>

    <!-- Slider -->
    <div v-else-if="item.widget === 'slider'">
      <!-- @vue-ignore -->
      <RangeControl
        v-model="boundValue"
        :label="item.label ? t(item.label) : ''"
        :min="item.min"
        :max="maxLimit"
        :step="item.step"
      >
        <template v-if="item.maxUnlockedId && item.unlockLabel" #addon>
          <div class="mt-1">
            <Checkbox
              v-model="maxUnlockedValue"
              :label="t(item.unlockLabel)"
              :title="item.unlockTooltip ? t(item.unlockTooltip) : ''"
            />
          </div>
        </template>
      </RangeControl>
    </div>

    <!-- Number Input -->
    <FormItem v-else-if="item.widget === 'number-input'" :label="item.label ? t(item.label) : ''">
      <!-- @vue-ignore -->
      <Input v-model="boundValue" type="number" :min="item.min" :max="item.max" :step="item.step" />
    </FormItem>

    <!-- Textarea -->
    <FormItem
      v-else-if="item.widget === 'textarea'"
      :label="item.label ? t(item.label) : ''"
      :description="item.description ? t(item.description) : undefined"
    >
      <!-- @vue-ignore -->
      <Textarea v-model="boundValue" />
    </FormItem>

    <!-- Text Input -->
    <FormItem v-else-if="item.widget === 'text-input'" :label="item.label ? t(item.label) : ''">
      <!-- @vue-ignore -->
      <Input v-model="boundValue" :placeholder="item.placeholder" />
    </FormItem>

    <!-- Checkbox -->
    <div v-else-if="item.widget === 'checkbox'">
      <!-- @vue-ignore -->
      <Checkbox
        v-model="boundValue"
        :label="item.label ? t(item.label) : ''"
        :description="item.description ? t(item.description) : undefined"
      />
    </div>

    <!-- Select -->
    <FormItem v-else-if="item.widget === 'select' && item.options" :label="item.label ? t(item.label) : ''">
      <!-- @vue-ignore -->
      <Select
        v-model="boundValue"
        :options="item.options.map((o) => ({ label: t(o.label), value: o.value }))"
        :title="item.infoTooltip ? t(item.infoTooltip) : undefined"
      />
    </FormItem>

    <!-- Draggable List -->
    <FormItem v-else-if="item.widget === 'draggable-list'" :label="item.label ? t(item.label) : ''">
      <!-- @vue-ignore -->
      <DraggableList v-model:items="boundValue" handle-class="draggable-handle">
        <template #default="{ item: val }">
          <ListItem class="draggable-handle">
            <template #start>
              <i class="fa-solid fa-grip-vertical"></i>
            </template>
            {{ getOptionLabel(item, val as unknown as number | string) }}
          </ListItem>
        </template>
      </DraggableList>
    </FormItem>

    <!-- Key Manager -->
    <FormItem v-else-if="item.widget === 'key-manager' && item.secretKey" :label="item.label ? t(item.label) : ''">
      <div class="api-connections-drawer-input-group">
        <Input
          v-model="secretStore.pendingSecrets[item.secretKey]"
          type="password"
          :placeholder="activeSecretPlaceholder"
        />
        <Button icon="fa-key" :title="t('apiConnections.manageKeys')" @click="openSecretManager" />
      </div>
    </FormItem>

    <!-- Info Display -->
    <div
      v-else-if="item.widget === 'info-display' && item.description"
      class="form-item-description"
      style="margin-bottom: 10px"
    >
      {{ t(item.description) }}
    </div>

    <!-- HR -->
    <hr v-else-if="item.widget === 'hr'" />

    <!-- Header -->
    <div v-else-if="item.widget === 'header'" class="standout-header">
      {{ item.label ? t(item.label) : '' }}
    </div>

    <!-- Prompt Manager Button -->
    <div v-else-if="item.widget === 'prompt-manager-button'">
      <!-- Placeholder -->
    </div>
  </div>
</template>
