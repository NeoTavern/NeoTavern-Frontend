<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useTagStore } from '../../stores/tag.store';
import type { CustomTag } from '../../types';
import { Button, ColorPicker, FormItem, Input, ListItem } from '../UI';

const { t } = useStrictI18n();
const tagStore = useTagStore();

const newTagName = ref('');
const newTagBackgroundColor = ref('#808080');
const newTagForegroundColor = ref('#FFFFFF');

const editingTag = ref<CustomTag | null>(null);
const editingTagOriginalName = ref('');

const sortedTags = computed(() => {
  return [...tagStore.customTags].sort((a, b) => a.name.localeCompare(b.name));
});

function handleAddTag() {
  if (!newTagName.value.trim()) return;

  const success = tagStore.addTag({
    name: newTagName.value.trim(),
    backgroundColor: newTagBackgroundColor.value,
    foregroundColor: newTagForegroundColor.value,
  });

  if (success) {
    newTagName.value = '';
  } else {
    // Optionally, show a toast notification for duplicate tag
  }
}

function startEditing(tag: CustomTag) {
  editingTagOriginalName.value = tag.name;
  editingTag.value = { ...tag };
}

function cancelEditing() {
  editingTag.value = null;
  editingTagOriginalName.value = '';
}

function handleUpdateTag() {
  if (!editingTag.value || !editingTagOriginalName.value) return;

  const success = tagStore.updateTag(editingTagOriginalName.value, {
    ...editingTag.value,
    name: editingTag.value.name.trim(),
  });

  if (success) {
    cancelEditing();
  } else {
    // Optionally, show a toast notification for duplicate tag name
  }
}

function handleDeleteTag(tagName: string) {
  tagStore.deleteTag(tagName);
  if (editingTag.value?.name === tagName) {
    cancelEditing();
  }
}
</script>

<template>
  <div class="custom-tag-manager">
    <div class="tag-list-section">
      <h3>{{ t('characterPanel.tags.existing') }}</h3>
      <div class="tag-list">
        <div v-if="sortedTags.length === 0" class="empty-list">
          {{ t('characterPanel.tags.noTags') }}
        </div>
        <ListItem v-for="tag in sortedTags" :key="tag.name" class="tag-item">
          <template #start>
            <div class="tag-preview-wrapper">
              <span class="tag-preview" :style="{ backgroundColor: tag.backgroundColor, color: tag.foregroundColor }">
                {{ tag.name }}
              </span>
            </div>
          </template>
          <template #end>
            <div class="tag-actions">
              <Button variant="ghost" icon="fa-solid fa-pencil" :title="t('common.edit')" @click="startEditing(tag)" />
              <Button
                variant="ghost"
                icon="fa-solid fa-trash"
                :title="t('common.delete')"
                @click="handleDeleteTag(tag.name)"
              />
            </div>
          </template>
        </ListItem>
      </div>
    </div>

    <div class="tag-form-section">
      <div v-if="editingTag" class="tag-form editing-form">
        <h3>{{ t('characterPanel.tags.editTitle') }}</h3>
        <FormItem :label="t('common.name')">
          <Input v-model="editingTag.name" />
        </FormItem>
        <div class="color-pickers">
          <ColorPicker v-model="editingTag.backgroundColor!" :label="t('characterPanel.tags.background')" />
          <ColorPicker v-model="editingTag.foregroundColor!" :label="t('characterPanel.tags.foreground')" />
        </div>
        <div class="form-actions">
          <Button @click="cancelEditing">{{ t('common.cancel') }}</Button>
          <Button variant="confirm" @click="handleUpdateTag">{{ t('common.save') }}</Button>
        </div>
      </div>
      <div v-else class="tag-form">
        <h3>{{ t('characterPanel.tags.addTitle') }}</h3>
        <FormItem :label="t('common.name')">
          <Input v-model="newTagName" />
        </FormItem>
        <div class="color-pickers">
          <ColorPicker v-model="newTagBackgroundColor" :label="t('characterPanel.tags.background')" />
          <ColorPicker v-model="newTagForegroundColor" :label="t('characterPanel.tags.foreground')" />
        </div>
        <div class="form-actions">
          <Button variant="confirm" :disabled="!newTagName.trim()" @click="handleAddTag">
            {{ t('characterPanel.tags.add') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
