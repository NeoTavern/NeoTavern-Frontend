<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { FormItem, CollapsibleSection, Toggle, RangeControl } from '../../../components/UI';
import { useStrictI18n } from '../../../composables/useStrictI18n';
import type { ExtensionAPI } from '../../../types';
import { DEFAULT_SETTINGS, type ExtensionSettings, type SettingChangeEvents } from './types.ts';

const props = defineProps<{
  api: ExtensionAPI<ExtensionSettings>;
}>();

const settings = ref<ExtensionSettings>(structuredClone(DEFAULT_SETTINGS));

const { t } = useStrictI18n();

onMounted(() => {
  const saved = props.api.settings.get();
  if (saved) {
    settings.value = { ...settings.value, ...saved };
  }
});

watch(
  settings,
  (newSettings) => {
    console.log(newSettings)
    props.api.settings.set(undefined, newSettings);
    props.api.settings.save();
  },
  { deep: true },
);

//All setting changes will emit an event.
function emitSettingChanged<K extends keyof ExtensionSettings>(setting: K, value: ExtensionSettings[K]) {
  props.api.events.emit(`undo:setting:${setting}` as keyof SettingChangeEvents, value)
}

</script>

<template>
  <div class="undo-settings">
    {{ t('extensionsBuiltin.undo.settings.chatLengthWarning') }}
    <li v-for="(value, setting) in settings" :key="setting">
      <div v-if="typeof(value)=='boolean'">
      {{ t(`extensionsBuiltin.undo.settings.${setting}` as any) }}
      <Toggle
        v-model="settings[setting] as boolean"
        :title="t(`extensionsBuiltin.undo.settings.${setting}` as any)"
        @change="emitSettingChanged(setting, value)"
      />
      </div>

      <RangeControl
        v-else-if="typeof(value)=='number'"
        v-model="settings[setting] as number"
        :label="t(`extensionsBuiltin.undo.settings.${setting}` as any)"
        :min="0"
        :step="10"
        :max="10000"
        @change="emitSettingChanged(setting, value)"
        />
    </li>

    <CollapsibleSection :title="t('extensionsBuiltin.undo.settings.snapshotEvents')" :is-open="false">
    {{ t('extensionsBuiltin.undo.settings.snapshotEventsDescription') }}
      <li v-for="(value, snapshotEvent) in settings.snapshotEvents" :key="snapshotEvent as string">
        <FormItem :label="snapshotEvent">
          <Toggle v-if="typeof(value)=='boolean'" v-model="settings.snapshotEvents[snapshotEvent] as boolean" @change="emitSettingChanged(snapshotEvent as any, value)" />
        </FormItem>
      </li>
    </CollapsibleSection>
  </div>
</template>