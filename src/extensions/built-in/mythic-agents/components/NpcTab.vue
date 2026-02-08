<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Input, Select } from '../../../../components/UI';
import { useMythicState } from '../composables/useMythicState';
import { DEFAULT_UNE_SETTINGS } from '../defaults';
import type { MythicCharacter, MythicExtensionAPI } from '../types';
import { genUNENpc } from '../une';

interface Props {
  api: MythicExtensionAPI;
}

const props = defineProps<Props>();

const { state: extra, getLatestMythicMessageIndex } = useMythicState(props.api);
const scene = computed(() => extra.value?.scene);

const typeOptions = computed(() => {
  const settings = props.api.settings.get();
  const currentPreset = settings.presets.find((p) => p.name === settings.selectedPreset) || settings.presets[0];
  const types = currentPreset?.data?.characterTypes || ['NPC'];
  return types.map((type) => ({ label: type, value: type }));
});

function getCurrentUNE() {
  const settings = props.api.settings.get();
  const currentPreset = settings.presets.find((p) => p.name === settings.selectedPreset) || settings.presets[0];
  return currentPreset?.data?.une || DEFAULT_UNE_SETTINGS;
}

function updateLatestExtra(update: Record<string, unknown>) {
  const mythicIndex = getLatestMythicMessageIndex();
  if (mythicIndex === null) return;
  const history = props.api.chat.getHistory();
  const msg = history[mythicIndex];
  const currentExtra = msg.extra?.['core.mythic-agents'];
  if (!currentExtra) return;
  const newExtra = { ...currentExtra, ...update };
  msg.extra = {
    ...msg.extra,
    'core.mythic-agents': newExtra,
  };
  props.api.chat.updateMessageObject(mythicIndex, {
    extra: msg.extra,
  });
}

const editingNpcId = ref<string | null>(null);
const editForm = ref({
  name: '',
  type: '',
  modifier: '',
  noun: '',
  motivation_verb: '',
  motivation_noun: '',
});

function startEdit(npc: MythicCharacter) {
  editingNpcId.value = npc.id;
  editForm.value = {
    name: npc.name,
    type: npc.type,
    modifier: npc.une_profile.modifier,
    noun: npc.une_profile.noun,
    motivation_verb: npc.une_profile.motivation_verb,
    motivation_noun: npc.une_profile.motivation_noun,
  };
}

function cancelEdit() {
  editingNpcId.value = null;
}

function saveEdit() {
  if (!editingNpcId.value) return;
  const updatedScene = {
    ...scene.value,
    characters:
      scene.value?.characters.map((c) =>
        c.id === editingNpcId.value
          ? {
              ...c,
              name: editForm.value.name,
              type: editForm.value.type,
              une_profile: {
                ...c.une_profile,
                modifier: editForm.value.modifier,
                noun: editForm.value.noun,
                motivation_verb: editForm.value.motivation_verb,
                motivation_noun: editForm.value.motivation_noun,
              },
            }
          : c,
      ) || [],
  };
  updateLatestExtra({ scene: updatedScene });
  editingNpcId.value = null;
}

function regenerateUNE(id: string) {
  const une = getCurrentUNE();
  const newUNE = genUNENpc(une.modifiers, une.nouns, une.motivation_verbs, une.motivation_nouns);
  const updatedScene = {
    ...scene.value,
    characters: scene.value?.characters.map((c) => (c.id === id ? { ...c, une_profile: newUNE } : c)) || [],
  };
  updateLatestExtra({ scene: updatedScene });
}

function addNpc() {
  const une = getCurrentUNE();
  const une_profile = genUNENpc(une.modifiers, une.nouns, une.motivation_verbs, une.motivation_nouns);
  const newNpc = {
    id: Date.now().toString(),
    name: `${une_profile.modifier} ${une_profile.noun}`,
    type: 'NPC',
    une_profile,
  };
  const updatedScene = {
    ...scene.value,
    characters: [...(scene.value?.characters || []), newNpc],
  };
  updateLatestExtra({ scene: updatedScene });
}

function removeNpc(id: string) {
  const updatedScene = {
    ...scene.value,
    characters: scene.value?.characters.filter((c) => c.id !== id) || [],
  };
  updateLatestExtra({ scene: updatedScene });
}
</script>

<template>
  <div class="npcs">
    <div class="actions">
      <Button block @click="addNpc"> <i class="fas fa-plus"></i> Add Random NPC </Button>
    </div>

    <div v-if="!scene?.characters?.length" class="empty-state">No characters in current scene.</div>

    <div class="npc-list">
      <div v-for="npc in scene?.characters || []" :key="npc.id" class="npc-card">
        <div class="npc-header">
          <div v-if="editingNpcId !== npc.id" class="npc-identity">
            <div class="npc-name">{{ npc.name }}</div>
            <div class="npc-type">{{ npc.type }}</div>
          </div>
          <div v-else class="npc-identity">
            <div class="edit-input-wrapper">
              <Input v-model="editForm.name" placeholder="Name" />
            </div>
            <div class="edit-input-wrapper">
              <Select v-model="editForm.type" :options="typeOptions" placeholder="Type" />
            </div>
          </div>
          <div class="npc-actions">
            <Button v-if="editingNpcId !== npc.id" size="small" title="Edit NPC" @click="startEdit(npc)">
              <i class="fas fa-edit"></i>
            </Button>
            <Button v-else size="small" variant="confirm" title="Save" @click="saveEdit">
              <i class="fas fa-check"></i>
            </Button>
            <Button v-if="editingNpcId === npc.id" size="small" variant="ghost" title="Cancel" @click="cancelEdit">
              <i class="fas fa-times"></i>
            </Button>
            <Button size="small" variant="danger" class="delete-btn" title="Remove NPC" @click="removeNpc(npc.id)">
              <i class="fas fa-trash"></i>
            </Button>
          </div>
        </div>

        <div class="npc-details">
          <div class="une-profile">
            <div class="profile-row">
              <span class="label">Identity:</span>
              <span v-if="editingNpcId !== npc.id" class="value"
                >{{ npc.une_profile.modifier }} {{ npc.une_profile.noun }}</span
              >
              <div v-else class="value">
                <Input v-model="editForm.modifier" placeholder="Modifier" style="width: 80px; margin-right: 4px" />
                <Input v-model="editForm.noun" placeholder="Noun" style="width: 80px" />
              </div>
              <Button v-if="editingNpcId !== npc.id" size="small" title="Regenerate UNE" @click="regenerateUNE(npc.id)">
                <i class="fas fa-dice"></i>
              </Button>
            </div>
            <div class="profile-row">
              <span class="label">Motivation:</span>
              <span v-if="editingNpcId !== npc.id" class="value">
                {{ npc.une_profile.motivation_verb }} {{ npc.une_profile.motivation_noun }}
              </span>
              <div v-else class="value">
                <Input v-model="editForm.motivation_verb" placeholder="Verb" style="width: 80px; margin-right: 4px" />
                <Input v-model="editForm.motivation_noun" placeholder="Noun" style="width: 80px" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.npcs {
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.actions {
  margin-bottom: var(--spacing-xs);
}

.npc-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.npc-card {
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-md);
  transition: border-color var(--animation-duration-sm);

  &:hover {
    border-color: var(--theme-border-color-hover, var(--grey-50));
  }
}

.npc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--theme-border-color);
  padding-bottom: var(--spacing-sm);
}

.npc-name {
  font-weight: bold;
  font-size: 1.1em;
  color: var(--theme-text-color);
}

.npc-type {
  font-size: 0.85em;
  color: var(--theme-emphasis-color);
  font-style: italic;
}

.npc-actions {
  display: flex;
  gap: var(--spacing-xs);
}

.edit-input-wrapper {
  width: 120px;
}

.une-profile {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-row {
  display: flex;
  gap: var(--spacing-sm);
  font-size: 0.9em;
}

.label {
  color: var(--theme-emphasis-color);
  width: 80px;
  flex-shrink: 0;
}

.value {
  color: var(--theme-text-color);
}

.empty-state {
  text-align: center;
  padding: var(--spacing-xl);
  color: var(--theme-emphasis-color);
  font-style: italic;
  background-color: var(--black-30a);
  border-radius: var(--base-border-radius);
}
</style>
