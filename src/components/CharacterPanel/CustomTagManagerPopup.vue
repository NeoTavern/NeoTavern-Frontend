<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useTagStore } from '../../stores/tag.store';
import type { CustomTag } from '../../types';
import { Button, ColorPicker, FormItem, Input, ListItem } from '../UI';

const { t } = useStrictI18n();
const tagStore = useTagStore();

const selectedTag = ref<CustomTag | null>(null);

const DEFAULT_FORM_STATE = {
  name: '',
  backgroundColor: '#808080',
  foregroundColor: '#FFFFFF',
};

const formState = ref<Omit<CustomTag, 'name'> & { name: string }>({ ...DEFAULT_FORM_STATE });

// Proxy computed property for the background color picker
const backgroundColorProxy = computed({
  get: () => formState.value.backgroundColor ?? '#FFFFFF', // Provide a default string if null
  set: (value: string) => {
    formState.value.backgroundColor = value;
  },
});

// Proxy computed property for the foreground color picker
const foregroundColorProxy = computed({
  get: () => formState.value.foregroundColor ?? '#000000', // Provide a default string if null
  set: (value: string) => {
    formState.value.foregroundColor = value;
  },
});

const isEditing = computed(() => !!selectedTag.value);

const sortedTags = computed(() => {
  return [...tagStore.customTags].sort((a, b) => a.name.localeCompare(b.name));
});

const tagsForDisplay = computed(() => {
  return sortedTags.value.map((tag) => {
    const isCurrentlyEditing = isEditing.value && selectedTag.value?.name === tag.name;

    return {
      originalName: tag.name,
      name: isCurrentlyEditing ? formState.value.name : tag.name,
      backgroundColor: isCurrentlyEditing ? formState.value.backgroundColor : tag.backgroundColor,
      foregroundColor: isCurrentlyEditing ? formState.value.foregroundColor : tag.foregroundColor,
    };
  });
});

watch(selectedTag, (newTag) => {
  if (newTag) {
    formState.value = {
      name: newTag.name,
      backgroundColor: newTag.backgroundColor ?? DEFAULT_FORM_STATE.backgroundColor,
      foregroundColor: newTag.foregroundColor ?? DEFAULT_FORM_STATE.foregroundColor,
    };
  } else {
    formState.value = { ...DEFAULT_FORM_STATE };
  }
});

function handleSelectTag(tagName: string) {
  const originalTag = sortedTags.value.find((t) => t.name === tagName);
  if (originalTag) {
    selectedTag.value = originalTag;
  }
}

function handleClearSelection() {
  selectedTag.value = null;
}

function handleSaveTag() {
  if (!formState.value.name.trim()) return;

  const tagData: CustomTag = {
    name: formState.value.name.trim(),
    backgroundColor: formState.value.backgroundColor,
    foregroundColor: formState.value.foregroundColor,
  };

  let success = false;
  if (isEditing.value && selectedTag.value) {
    success = tagStore.updateTag(selectedTag.value.name, tagData);
  } else {
    success = tagStore.addTag(tagData);
  }

  if (success) {
    handleClearSelection();
  }
}

function handleDeleteTag() {
  if (!selectedTag.value) return;
  tagStore.deleteTag(selectedTag.value.name);
  handleClearSelection();
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
        <ListItem
          v-for="tag in tagsForDisplay"
          :key="tag.originalName"
          class="tag-item"
          :active="selectedTag?.name === tag.originalName"
          @click="handleSelectTag(tag.originalName)"
        >
          <template #start>
            <div class="tag-preview-wrapper">
              <span
                class="ui-tag"
                :class="{ 'no-color': !tag.backgroundColor }"
                :style="{
                  backgroundColor: tag.backgroundColor ?? undefined,
                  color: tag.foregroundColor ?? undefined,
                }"
              >
                {{ tag.name }}
              </span>
            </div>
          </template>
        </ListItem>
      </div>
    </div>

    <div class="tag-form-section">
      <div class="tag-form" :class="{ 'editing-form': isEditing }">
        <h3>{{ isEditing ? t('characterPanel.tags.editTitle') : t('characterPanel.tags.addTitle') }}</h3>
        <FormItem :label="t('common.name')">
          <Input v-model="formState.name" />
        </FormItem>
        <div class="color-pickers">
          <div class="color-picker-group">
            <ColorPicker v-model="backgroundColorProxy" :label="t('characterPanel.tags.background')" />
            <Button
              variant="ghost"
              icon="fa-solid fa-xmark"
              :title="t('characterPanel.tags.removeColor')"
              @click="formState.backgroundColor = null"
            />
          </div>
          <div class="color-picker-group">
            <ColorPicker v-model="foregroundColorProxy" :label="t('characterPanel.tags.foreground')" />
            <Button
              variant="ghost"
              icon="fa-solid fa-xmark"
              :title="t('characterPanel.tags.removeColor')"
              @click="formState.foregroundColor = null"
            />
          </div>
        </div>
        <div class="form-actions">
          <Button v-if="isEditing" variant="danger" @click="handleDeleteTag">
            {{ t('common.delete') }}
          </Button>
          <div style="flex-grow: 1"></div>
          <Button @click="handleClearSelection">{{ isEditing ? t('common.cancel') : t('common.clear') }}</Button>
          <Button variant="confirm" :disabled="!formState.name.trim()" @click="handleSaveTag">
            {{ isEditing ? t('common.save') : t('characterPanel.tags.add') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
