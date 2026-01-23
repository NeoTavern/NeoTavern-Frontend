<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useCharacterUiStore } from '../../stores/character-ui.store';
import { useCharacterStore } from '../../stores/character.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useTagStore } from '../../stores/tag.store';
import { Button, FormItem, TagInput } from '../UI';

const props = defineProps<{
  avatars: string[];
  closePopup: () => void;
}>();

const { t } = useStrictI18n();
const tagStore = useTagStore();
const characterUiStore = useCharacterUiStore();
const characterStore = useCharacterStore();
const settingsStore = useSettingsStore();

const tagsToAdd = ref<string[]>([]);
const tagsToRemove = ref<string[]>([]);

const allCharacterTags = computed(() => {
  const tags = new Set<string>();
  for (const avatar of props.avatars) {
    // Add custom tags
    characterUiStore.tagStore.getCustomTagsForCharacter(avatar).forEach((tag) => tags.add(tag));

    // Add embedded tags
    if (!settingsStore.settings.character.hideEmbeddedTagsInSuggestions) {
      const character = characterStore.characters.find((c) => c.avatar === avatar);
      character?.tags?.forEach((tag) => tags.add(tag));
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
});

function handleApply() {
  tagStore.bulkUpdateTags(props.avatars, tagsToAdd.value, tagsToRemove.value);
  characterUiStore.clearCharacterSelection();
  props.closePopup();
}
</script>

<template>
  <div class="bulk-tag-editor">
    <p>
      {{ t('characterPanel.bulkTags.description', { count: props.avatars.length }) }}
    </p>

    <FormItem :label="t('characterPanel.bulkTags.addTags')">
      <TagInput
        v-model="tagsToAdd"
        :placeholder="t('characterPanel.bulkTags.addPlaceholder')"
        :suggestions="characterUiStore.availableTags"
      />
    </FormItem>

    <FormItem :label="t('characterPanel.bulkTags.removeTags')">
      <TagInput
        v-model="tagsToRemove"
        :suggestions="allCharacterTags"
        :placeholder="t('characterPanel.bulkTags.removePlaceholder')"
        :only-suggestions="true"
      />
    </FormItem>

    <div class="popup-actions">
      <Button @click="props.closePopup">{{ t('common.cancel') }}</Button>
      <Button variant="confirm" @click="handleApply">
        {{ t('common.apply') }}
      </Button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.bulk-tag-editor {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.popup-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}
</style>
