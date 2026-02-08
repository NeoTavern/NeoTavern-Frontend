<script setup lang="ts">
import { computed } from 'vue';
import { Button, Checkbox, CollapsibleSection, FormItem, Input, Select, Textarea } from '../../../../components/UI';
import type { ExtensionAPI, WorldInfoBook } from '../../../../types';
import type { RewriteSettings, RewriteTemplate } from '../types';

const props = defineProps<{
  api: ExtensionAPI<RewriteSettings>;
  activeTab: string;
  currentTemplate: RewriteTemplate | undefined;
  argOverrides: Record<string, boolean | number | string>;
  escapeMacros: boolean;
  contextMessageCount: number;
  isCharacterContextOpen: boolean;
  isWorldInfoContextOpen: boolean;
  selectedContextCharacters: string[];
  selectedContextLorebooks: string[];
  selectedContextEntries: Record<string, number[]>;
  availableLorebooks: { label: string; value: string }[];
  availableCharacters: { label: string; value: string }[];
  selectedEntryContext: { bookName: string; entry: { uid: number; comment: string } } | null;
  isWorldInfoField: boolean;
  promptOverride: string;
  structuredResponseFormat: string;
  canResetPrompt: boolean;
  bookCache: Record<string, WorldInfoBook>;
}>();

interface ComponentEmits {
  'update:argOverrides': [value: Record<string, boolean | number | string>];
  'update:escapeMacros': [value: boolean];
  'update:contextMessageCount': [value: number];
  'update:isCharacterContextOpen': [value: boolean];
  'update:isWorldInfoContextOpen': [value: boolean];
  'update:selectedContextCharacters': [value: string[]];
  'update:selectedContextLorebooks': [value: string[]];
  'update:selectedContextEntries': [value: Record<string, number[]>];
  'update:promptOverride': [value: string];
  'update:structuredResponseFormat': [value: string];
  resetPrompt: [];
}

const emit = defineEmits<ComponentEmits>();

const t = props.api.i18n.t;

const showWorldInfoContextSection = computed(() => {
  const arg = props.currentTemplate?.args?.find((a) => a.key === 'includeSelectedBookContext');
  if (!arg) return false;
  return !!props.argOverrides['includeSelectedBookContext'];
});

const showCharacterContextSection = computed(() => {
  const arg = props.currentTemplate?.args?.find((a) => a.key === 'includeSelectedCharacters');
  if (!arg) return false;
  return !!props.argOverrides['includeSelectedCharacters'];
});

function getEntriesForBook(bookName: string) {
  const book = props.bookCache[bookName];
  if (!book) return [];
  return book.entries.map((e) => ({
    label: `${e.uid}: ${e.comment || '(No Title)'}`,
    value: e.uid,
  }));
}

function getArgOverrideValue(key: string): string | number {
  return props.argOverrides[key] as string | number;
}
</script>

<template>
  <CollapsibleSection :title="t('extensionsBuiltin.rewrite.popup.contextPrompt')" :is-open="true">
    <!-- Dynamic Arguments -->
    <div v-if="currentTemplate?.args && currentTemplate.args.length > 0" class="dynamic-args-grid">
      <div v-for="arg in currentTemplate.args" :key="arg.key" class="dynamic-arg-item">
        <Checkbox
          v-if="arg.type === 'boolean'"
          :model-value="argOverrides[arg.key] as boolean"
          :label="arg.label"
          @update:model-value="emit('update:argOverrides', { ...argOverrides, [arg.key]: $event })"
        />
        <FormItem v-else :label="arg.label">
          <Input
            :model-value="getArgOverrideValue(arg.key)"
            :type="arg.type === 'number' ? 'number' : 'text'"
            @update:model-value="emit('update:argOverrides', { ...argOverrides, [arg.key]: $event })"
          />
        </FormItem>
      </div>
    </div>

    <div class="context-controls">
      <div v-if="!currentTemplate?.ignoreInput && activeTab === 'one-shot'" class="escape-control">
        <Checkbox
          :model-value="escapeMacros"
          :label="t('extensionsBuiltin.rewrite.popup.escapeMacros')"
          :title="t('extensionsBuiltin.rewrite.popup.escapeMacrosHint')"
          @update:model-value="emit('update:escapeMacros', $event)"
        />
      </div>
      <div class="flex-spacer"></div>
      <div class="msg-count-control">
        <span class="label">{{ t('extensionsBuiltin.rewrite.popup.contextMessages') }}</span>
        <Input
          :model-value="contextMessageCount"
          type="number"
          :min="0"
          @update:model-value="emit('update:contextMessageCount', Number($event))"
        />
      </div>
    </div>

    <!-- Character Context -->
    <CollapsibleSection
      v-if="showCharacterContextSection"
      :is-open="isCharacterContextOpen"
      class="inner-collapsible"
      :title="t('extensionsBuiltin.rewrite.popup.relatedCharacters')"
      @update:is-open="emit('update:isCharacterContextOpen', $event)"
    >
      <FormItem
        :label="t('extensionsBuiltin.rewrite.popup.contextCharacters')"
        :description="t('extensionsBuiltin.rewrite.popup.contextCharactersDesc')"
        class="character-select"
      >
        <Select
          :model-value="selectedContextCharacters"
          :options="availableCharacters"
          multiple
          :placeholder="t('common.select')"
          @update:model-value="(emit as any)('update:selectedContextCharacters', $event)"
        />
      </FormItem>
    </CollapsibleSection>

    <!-- World Info Context -->
    <CollapsibleSection
      v-if="showWorldInfoContextSection"
      :is-open="isWorldInfoContextOpen"
      class="inner-collapsible"
      :title="t('extensionsBuiltin.rewrite.popup.worldInfoContext')"
      @update:is-open="emit('update:isWorldInfoContextOpen', $event)"
    >
      <div v-if="selectedEntryContext && isWorldInfoField" class="current-context-info">
        {{ t('extensionsBuiltin.rewrite.popup.currentEntry') }}:
        <strong>{{ selectedEntryContext.entry.comment }}</strong> (ID: {{ selectedEntryContext.entry.uid }})
      </div>

      <FormItem
        :label="t('extensionsBuiltin.rewrite.popup.contextLorebooks')"
        :description="t('extensionsBuiltin.rewrite.popup.contextLorebooksDesc')"
        class="lorebook-select"
      >
        <Select
          :model-value="selectedContextLorebooks"
          :options="availableLorebooks"
          multiple
          :placeholder="t('common.select')"
          @update:model-value="(emit as any)('update:selectedContextLorebooks', $event)"
        />
      </FormItem>

      <div v-if="selectedContextLorebooks.length > 0" class="book-entries-selection">
        <div v-for="bookName in selectedContextLorebooks" :key="bookName" class="book-entry-row">
          <div class="book-label">{{ bookName }}</div>
          <div class="entries-select">
            <Select
              :model-value="selectedContextEntries[bookName] || []"
              :options="getEntriesForBook(bookName)"
              multiple
              :placeholder="t('extensionsBuiltin.rewrite.popup.allEntries')"
              @update:model-value="
                (emit as any)('update:selectedContextEntries', { ...selectedContextEntries, [bookName]: $event })
              "
            />
          </div>
        </div>
      </div>
    </CollapsibleSection>

    <!-- One-Shot Prompt Override -->
    <FormItem v-if="activeTab === 'one-shot'" :label="t('extensionsBuiltin.rewrite.popup.instruction')">
      <div class="input-with-reset">
        <Textarea
          :model-value="promptOverride"
          :rows="2"
          allow-maximize
          @update:model-value="emit('update:promptOverride', $event)"
        />
        <Button
          v-if="canResetPrompt"
          class="reset-btn"
          icon="fa-rotate-left"
          variant="ghost"
          :title="t('extensionsBuiltin.rewrite.settings.resetToDefault')"
          @click="emit('resetPrompt')"
        />
      </div>
    </FormItem>

    <!-- Session Mode Settings -->
    <div v-if="activeTab === 'session'" class="session-settings">
      <FormItem :label="t('extensionsBuiltin.rewrite.popup.structuredResponseFormat')">
        <Select
          :model-value="structuredResponseFormat"
          :options="[
            { label: 'Native (Structured)', value: 'native' },
            { label: 'JSON (Structured)', value: 'json' },
            { label: 'XML (Structured)', value: 'xml' },
            { label: 'Raw Text (Readonly/Chat)', value: 'text' },
          ]"
          @update:model-value="emit('update:structuredResponseFormat', $event as string)"
        />
      </FormItem>
    </div>
  </CollapsibleSection>
</template>

<style scoped lang="scss">
.dynamic-args-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 15px;
  padding-bottom: 15px;
  border-bottom: 1px dashed var(--theme-border-color);
}

.context-controls {
  display: flex;
  gap: 15px;
  align-items: center;
  margin-bottom: 10px;
}

.flex-spacer {
  flex: 1;
}

.msg-count-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
}

.escape-control {
  display: flex;
  align-items: center;
}

.input-with-reset {
  position: relative;
  display: flex;
}
.reset-btn {
  margin-left: 5px;
  height: auto;
  align-self: flex-start;
}

.inner-collapsible {
  margin-bottom: 15px;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: 5px;
  background-color: var(--black-20a);
}

.current-context-info {
  font-size: 0.85em;
  opacity: 0.8;
  margin-top: 5px;
  margin-bottom: 10px;
  padding: 5px;
  border-bottom: 1px solid var(--theme-border-color);
}

.lorebook-select,
.character-select {
  margin-bottom: 10px;
}

.book-entries-selection {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 5px;
  border-top: 1px dashed var(--theme-border-color);
}

.book-entry-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.book-label {
  width: 120px;
  font-size: 0.9em;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entries-select {
  flex: 1;
}

.session-settings {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--theme-border-color);
}
</style>
