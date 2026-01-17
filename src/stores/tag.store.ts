import { defineStore } from 'pinia';
import { computed } from 'vue';
import type { CustomTag } from '../types';
import { eventEmitter } from '../utils/event-emitter';
import { useSettingsStore } from './settings.store';

export const useTagStore = defineStore('tag', () => {
  const settingsStore = useSettingsStore();

  const customTags = computed({
    get: () => settingsStore.settings.character.customTags ?? [],
    set: (value) => (settingsStore.settings.character.customTags = value),
  });

  const customTagAssignments = computed({
    get: () => settingsStore.settings.character.customTagAssignments ?? {},
    set: (value) => (settingsStore.settings.character.customTagAssignments = value),
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

  function addTag(tag: CustomTag): boolean {
    if (getTagProperties(tag.name)) {
      console.warn(`Tag with name "${tag.name}" already exists.`);
      return false;
    }
    const newTags = [...customTags.value, tag];
    customTags.value = newTags;
    return true;
  }

  function updateTag(originalName: string, updatedTag: CustomTag): boolean {
    const lowerOriginalName = originalName.toLowerCase();
    const index = customTags.value.findIndex((t) => t.name.toLowerCase() === lowerOriginalName);

    if (index === -1) return false;

    // If name is being changed, check for conflicts
    if (originalName.toLowerCase() !== updatedTag.name.toLowerCase() && getTagProperties(updatedTag.name)) {
      console.warn(`Tag with name "${updatedTag.name}" already exists.`);
      return false;
    }

    const newTags = [...customTags.value];
    newTags[index] = updatedTag;
    customTags.value = newTags;

    // Update assignments if tag name changed
    if (originalName !== updatedTag.name) {
      const newAssignments: Record<string, string[]> = {};
      for (const [avatar, tags] of Object.entries(customTagAssignments.value)) {
        const updatedTags = tags.map((t) => (t === originalName ? updatedTag.name : t));
        newAssignments[avatar] = updatedTags;
      }
      customTagAssignments.value = newAssignments;
    }
    return true;
  }

  function deleteTag(tagName: string): boolean {
    const initialLength = customTags.value.length;
    customTags.value = customTags.value.filter((t) => t.name.toLowerCase() !== tagName.toLowerCase());

    // Remove deleted tag from all character assignments
    const newAssignments: Record<string, string[]> = {};
    for (const [avatar, tags] of Object.entries(customTagAssignments.value)) {
      newAssignments[avatar] = tags.filter((t) => t.toLowerCase() !== tagName.toLowerCase());
    }
    customTagAssignments.value = newAssignments;

    return customTags.value.length < initialLength;
  }

  function getCustomTagsForCharacter(avatar: string): string[] {
    return customTagAssignments.value[avatar] ?? [];
  }

  function setCustomTagsForCharacter(avatar: string, tags: string[]) {
    const newAssignments = { ...customTagAssignments.value };
    if (tags.length > 0) {
      newAssignments[avatar] = tags;
    } else {
      delete newAssignments[avatar];
    }
    customTagAssignments.value = newAssignments;
  }

  function removeAssignmentsForCharacter(avatar: string) {
    const newAssignments = { ...customTagAssignments.value };
    delete newAssignments[avatar];
    customTagAssignments.value = newAssignments;
  }

  function initialize() {
    eventEmitter.on('character:deleted', (avatar) => {
      removeAssignmentsForCharacter(avatar);
    });
  }

  return {
    customTags,
    customTagAssignments,
    getTagProperties,
    addTag,
    updateTag,
    deleteTag,
    getCustomTagsForCharacter,
    setCustomTagsForCharacter,
    initialize,
  };
});
