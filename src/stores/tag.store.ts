import { defineStore } from 'pinia';
import { computed } from 'vue';
import type { CustomTag } from '../types';
import { useSettingsStore } from './settings.store';

export const useTagStore = defineStore('tag', () => {
  const settingsStore = useSettingsStore();

  const customTags = computed({
    get: () => settingsStore.settings.character.customTags ?? [],
    set: (value) => (settingsStore.settings.character.customTags = value),
  });

  const customTagsMap = computed(() => {
    const map = new Map<string, CustomTag>();
    for (const tag of customTags.value) {
      map.set(tag.name.toLowerCase(), tag);
    }
    return map;
  });

  function getTagProperties(tagName: string): CustomTag | undefined {
    return customTagsMap.value.get(tagName.toLowerCase());
  }

  function addTag(tag: CustomTag) {
    if (getTagProperties(tag.name)) {
      console.warn(`Tag with name "${tag.name}" already exists.`);
      return false;
    }
    const newTags = [...customTags.value, tag];
    customTags.value = newTags;
    return true;
  }

  function updateTag(originalName: string, updatedTag: CustomTag) {
    const lowerOriginalName = originalName.toLowerCase();
    const index = customTags.value.findIndex((t) => t.name.toLowerCase() === lowerOriginalName);

    if (index !== -1) {
      // If name is being changed, check for conflicts
      if (originalName.toLowerCase() !== updatedTag.name.toLowerCase() && getTagProperties(updatedTag.name)) {
        console.warn(`Tag with name "${updatedTag.name}" already exists.`);
        return false;
      }

      const newTags = [...customTags.value];
      newTags[index] = updatedTag;
      customTags.value = newTags;
      return true;
    }
    return false;
  }

  function deleteTag(tagName: string) {
    const initialLength = customTags.value.length;
    customTags.value = customTags.value.filter((t) => t.name.toLowerCase() !== tagName.toLowerCase());
    return customTags.value.length < initialLength;
  }

  return {
    customTags,
    getTagProperties,
    addTag,
    updateTag,
    deleteTag,
  };
});
