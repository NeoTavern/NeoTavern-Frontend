<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Button, FormItem, Input, RangeControl, Select, Toggle } from '../../../components/UI';
import type { ApiProvider } from '../../../types';
import { api_providers, type ExtensionAPI } from '../../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import { uuidv4 } from '../../../utils/commons';
import { DEFAULT_SETTINGS, type ModelGroup, type RandomizerProfile, type RandomizerSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<RandomizerSettings>;
}>();

const t = props.api.i18n.t;

const settings = ref<RandomizerSettings>({ ...DEFAULT_SETTINGS });
const selectedProfileId = ref<string>('');
const editingGroupId = ref<string | null>(null);
const modelOptions = ref<{ label: string; value: string }[]>([]);
const loadingModels = ref(false);
const modelsLoadedOnce = ref(false);
const manualModelInput = ref<Record<string, string>>({});

onMounted(() => {
  const saved = props.api.settings.get();
  if (saved) {
    settings.value = { ...DEFAULT_SETTINGS, ...saved };
  }
  if (settings.value.profiles.length > 0) {
    selectedProfileId.value = settings.value.activeProfileId || settings.value.profiles[0].id;
  }
});

watch(
  settings,
  (newSettings) => {
    props.api.settings.set(undefined, newSettings);
    props.api.settings.save();
  },
  { deep: true },
);

const profileOptions = computed(() => {
  return settings.value.profiles.map((p) => ({
    label: `${p.name} (${p.type === 'connection-profiles' ? 'Profiles' : 'Groups'})`,
    value: p.id,
  }));
});

const selectedProfile = computed(() => {
  return settings.value.profiles.find((p) => p.id === selectedProfileId.value);
});

const connectionProfileOptions = computed(() => {
  const profiles = props.api.api.getConnectionProfiles();
  return profiles.map((p) => ({
    label: p.name,
    value: p.id,
  }));
});

const providerOptions = computed(() => {
  const providers = props.api.api.getProviders();
  return [
    {
      label: '',
      options: [{ label: t('apiConnections.providers.custom'), value: providers.CUSTOM }],
    },
    {
      label: '',
      options: [
        { label: t('apiConnections.providers.ai21'), value: providers.AI21 },
        { label: t('apiConnections.providers.aimlapi'), value: providers.AIMLAPI },
        { label: t('apiConnections.providers.azure_openai'), value: providers.AZURE_OPENAI },
        { label: t('apiConnections.providers.claude'), value: providers.CLAUDE },
        { label: t('apiConnections.providers.cohere'), value: providers.COHERE },
        { label: t('apiConnections.providers.deepseek'), value: providers.DEEPSEEK },
        { label: t('apiConnections.providers.electronhub'), value: providers.ELECTRONHUB },
        { label: t('apiConnections.providers.fireworks'), value: providers.FIREWORKS },
        { label: t('apiConnections.providers.groq'), value: providers.GROQ },
        { label: t('apiConnections.providers.makersuite'), value: providers.MAKERSUITE },
        { label: t('apiConnections.providers.vertexai'), value: providers.VERTEXAI },
        { label: t('apiConnections.providers.mistralai'), value: providers.MISTRALAI },
        { label: t('apiConnections.providers.moonshot'), value: providers.MOONSHOT },
        { label: t('apiConnections.providers.nanogpt'), value: providers.NANOGPT },
        { label: t('apiConnections.providers.ollama'), value: providers.OLLAMA },
        { label: t('apiConnections.providers.openai'), value: providers.OPENAI },
        { label: t('apiConnections.providers.openrouter'), value: providers.OPENROUTER },
        { label: t('apiConnections.providers.perplexity'), value: providers.PERPLEXITY },
        { label: t('apiConnections.providers.pollinations'), value: providers.POLLINATIONS },
        { label: t('apiConnections.providers.xai'), value: providers.XAI },
        { label: t('apiConnections.providers.zai'), value: providers.ZAI },
        { label: t('apiConnections.providers.koboldcpp'), value: providers.KOBOLDCPP },
      ],
    },
  ];
});

async function loadModelOptions(provider: ApiProvider) {
  loadingModels.value = true;
  modelsLoadedOnce.value = false;
  try {
    const models = await props.api.api.getModelsForProvider(provider);
    modelOptions.value = models.map((m) => ({
      label: m.name || m.id,
      value: m.id,
    }));
  } catch (error) {
    console.error('Failed to load models:', error);
    modelOptions.value = [];
  } finally {
    loadingModels.value = false;
    modelsLoadedOnce.value = true;
  }
}

function addManualModel(groupId: string, group: ModelGroup) {
  const modelId = manualModelInput.value[groupId]?.trim();
  if (!modelId) return;

  if (!group.modelIds.includes(modelId)) {
    group.modelIds.push(modelId);
  }
  manualModelInput.value[groupId] = '';
}

function removeManualModel(group: ModelGroup, modelId: string) {
  const index = group.modelIds.indexOf(modelId);
  if (index > -1) {
    group.modelIds.splice(index, 1);
  }
}

function getModelsPlaceholder(provider: ApiProvider): string {
  if (loadingModels.value) {
    return t('common.loading');
  }
  if (modelsLoadedOnce.value && modelOptions.value.length === 0) {
    if (provider === api_providers.OLLAMA || provider === api_providers.KOBOLDCPP) {
      return t('extensionsBuiltin.modelRandomizer.noModelsLocal');
    }
    return t('extensionsBuiltin.modelRandomizer.noModels');
  }
  return t('extensionsBuiltin.modelRandomizer.selectModels');
}

async function createProfile() {
  const { result, value } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.modelRandomizer.popups.createProfileTitle'),
    type: POPUP_TYPE.INPUT,
    inputValue: t('extensionsBuiltin.modelRandomizer.popups.newProfileName'),
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && value) {
    if (settings.value.profiles.some((p) => p.name === value)) {
      props.api.ui.showToast(t('extensionsBuiltin.modelRandomizer.toasts.profileExists'), 'error');
      return;
    }

    const typeResult = await props.api.ui.showPopup({
      title: t('extensionsBuiltin.modelRandomizer.popups.selectTypeTitle'),
      content: t('extensionsBuiltin.modelRandomizer.popups.selectTypeContent'),
      type: POPUP_TYPE.SELECT,
      selectOptions: [
        { label: t('extensionsBuiltin.modelRandomizer.types.connectionProfiles'), value: 'connection-profiles' },
        { label: t('extensionsBuiltin.modelRandomizer.types.modelGroups'), value: 'model-groups' },
      ],
    });

    if (typeResult.result !== POPUP_RESULT.AFFIRMATIVE || !typeResult.value) return;

    const newProfile: RandomizerProfile = {
      id: uuidv4(),
      name: value,
      type: typeResult.value as 'connection-profiles' | 'model-groups',
      enabled: true,
      connectionProfileIds: typeResult.value === 'connection-profiles' ? [] : undefined,
      modelGroups: typeResult.value === 'model-groups' ? [] : undefined,
    };

    settings.value.profiles.push(newProfile);
    selectedProfileId.value = newProfile.id;
    props.api.ui.showToast(t('extensionsBuiltin.modelRandomizer.toasts.profileCreated'), 'success');
  }
}

async function renameProfile() {
  if (!selectedProfile.value) return;

  const { result, value } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.modelRandomizer.popups.renameProfileTitle'),
    type: POPUP_TYPE.INPUT,
    inputValue: selectedProfile.value.name,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && value) {
    if (settings.value.profiles.some((p) => p.name === value && p.id !== selectedProfile.value!.id)) {
      props.api.ui.showToast(t('extensionsBuiltin.modelRandomizer.toasts.profileExists'), 'error');
      return;
    }

    selectedProfile.value.name = value;
    props.api.ui.showToast(t('extensionsBuiltin.modelRandomizer.toasts.profileRenamed'), 'success');
  }
}

async function deleteProfile() {
  if (!selectedProfile.value) return;

  const { result } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.modelRandomizer.popups.deleteProfileTitle'),
    content: t('extensionsBuiltin.modelRandomizer.popups.deleteProfileContent', { name: selectedProfile.value.name }),
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.delete',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    const index = settings.value.profiles.findIndex((p) => p.id === selectedProfile.value!.id);
    if (index > -1) {
      settings.value.profiles.splice(index, 1);
      if (settings.value.activeProfileId === selectedProfile.value.id) {
        settings.value.activeProfileId = settings.value.profiles[0]?.id || '';
      }
      selectedProfileId.value = settings.value.profiles[0]?.id || '';
      props.api.ui.showToast(t('extensionsBuiltin.modelRandomizer.toasts.profileDeleted'), 'success');
    }
  }
}

function setActiveProfile() {
  if (selectedProfile.value) {
    settings.value.activeProfileId = selectedProfile.value.id;
    props.api.ui.showToast(t('extensionsBuiltin.modelRandomizer.toasts.profileActivated'), 'success');
  }
}

function addModelGroup() {
  if (!selectedProfile.value || selectedProfile.value.type !== 'model-groups') return;

  const newGroup: ModelGroup = {
    id: uuidv4(),
    name: t('extensionsBuiltin.modelRandomizer.groups.newGroup'),
    provider: api_providers.OPENAI,
    modelIds: [],
  };

  if (!selectedProfile.value.modelGroups) {
    selectedProfile.value.modelGroups = [];
  }

  selectedProfile.value.modelGroups.push(newGroup);
  editingGroupId.value = newGroup.id;
}

function deleteModelGroup(groupId: string) {
  if (!selectedProfile.value || !selectedProfile.value.modelGroups) return;

  const index = selectedProfile.value.modelGroups.findIndex((g) => g.id === groupId);
  if (index > -1) {
    selectedProfile.value.modelGroups.splice(index, 1);
    if (editingGroupId.value === groupId) {
      editingGroupId.value = null;
    }
  }
}

function toggleTemperatureRange(group: ModelGroup) {
  if (group.temperatureRange) {
    delete group.temperatureRange;
  } else {
    group.temperatureRange = { min: 0.7, max: 1.0 };
  }
}

const isProfileActive = computed(() => {
  return selectedProfile.value?.id === settings.value.activeProfileId;
});
</script>

<template>
  <div class="model-randomizer-settings">
    <FormItem :label="t('extensionsBuiltin.modelRandomizer.enabled')">
      <Toggle v-model="settings.enabled" />
    </FormItem>

    <div class="profile-management">
      <FormItem :label="t('extensionsBuiltin.modelRandomizer.profile')">
        <div class="profile-controls">
          <Select
            v-model="selectedProfileId"
            :options="profileOptions"
            :placeholder="t('extensionsBuiltin.modelRandomizer.selectProfile')"
            class="profile-select"
          />
          <Button size="small" variant="confirm" @click="createProfile">
            <i class="fa-solid fa-plus"></i>
          </Button>
        </div>
      </FormItem>

      <div v-if="selectedProfile" class="profile-actions">
        <Button size="small" @click="renameProfile">
          <i class="fa-solid fa-pen"></i>
          {{ t('common.rename') }}
        </Button>
        <Button size="small" variant="danger" :disabled="settings.profiles.length <= 1" @click="deleteProfile">
          <i class="fa-solid fa-trash"></i>
          {{ t('common.delete') }}
        </Button>
        <Button size="small" variant="confirm" :disabled="isProfileActive" @click="setActiveProfile">
          <i class="fa-solid fa-check"></i>
          {{ t('extensionsBuiltin.modelRandomizer.setActive') }}
        </Button>
      </div>
    </div>

    <div v-if="selectedProfile" class="profile-content">
      <FormItem :label="t('extensionsBuiltin.modelRandomizer.profileEnabled')">
        <Toggle v-model="selectedProfile.enabled" />
      </FormItem>

      <div v-if="selectedProfile.type === 'connection-profiles'" class="connection-profiles-config">
        <FormItem :label="t('extensionsBuiltin.modelRandomizer.connectionProfiles')">
          <Select
            v-model="selectedProfile.connectionProfileIds!"
            :options="connectionProfileOptions"
            multiple
            :placeholder="t('extensionsBuiltin.modelRandomizer.selectConnectionProfiles')"
          />
        </FormItem>
      </div>

      <div v-else-if="selectedProfile.type === 'model-groups'" class="model-groups-config">
        <div class="groups-header">
          <h3>{{ t('extensionsBuiltin.modelRandomizer.modelGroups') }}</h3>
          <Button size="small" variant="confirm" @click="addModelGroup">
            <i class="fa-solid fa-plus"></i>
            {{ t('extensionsBuiltin.modelRandomizer.addGroup') }}
          </Button>
        </div>

        <div v-if="selectedProfile.modelGroups && selectedProfile.modelGroups.length > 0" class="groups-list">
          <div v-for="group in selectedProfile.modelGroups" :key="group.id" class="group-item">
            <div class="group-header" @click="editingGroupId = editingGroupId === group.id ? null : group.id">
              <div class="group-info">
                <i class="fa-solid" :class="editingGroupId === group.id ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
                <span class="group-name">{{ group.name }}</span>
                <span class="group-badge">{{ group.provider }}</span>
                <span class="group-count">{{ group.modelIds.length }} models</span>
              </div>
              <Button size="small" variant="danger" @click.stop="deleteModelGroup(group.id)">
                <i class="fa-solid fa-trash"></i>
              </Button>
            </div>

            <div v-if="editingGroupId === group.id" class="group-details">
              <FormItem :label="t('extensionsBuiltin.modelRandomizer.groupName')">
                <Input v-model="group.name" />
              </FormItem>

              <FormItem :label="t('extensionsBuiltin.modelRandomizer.provider')">
                <Select
                  v-model="group.provider"
                  :options="providerOptions"
                  searchable
                  @update:model-value="() => loadModelOptions(group.provider)"
                />
              </FormItem>

              <FormItem :label="t('extensionsBuiltin.modelRandomizer.models')">
                <Select
                  v-if="modelOptions.length > 0"
                  v-model="group.modelIds"
                  :options="modelOptions"
                  multiple
                  searchable
                  :disabled="loadingModels"
                  :placeholder="getModelsPlaceholder(group.provider)"
                />
                <div v-else-if="modelsLoadedOnce && !loadingModels" class="manual-model-input">
                  <div class="input-group">
                    <Input
                      v-model="manualModelInput[group.id]"
                      :placeholder="t('extensionsBuiltin.modelRandomizer.enterModelId')"
                      @keyup.enter="addManualModel(group.id, group)"
                    />
                    <Button size="small" variant="confirm" @click="addManualModel(group.id, group)">
                      <i class="fa-solid fa-plus"></i>
                      {{ t('common.add') }}
                    </Button>
                  </div>
                  <div v-if="group.modelIds.length > 0" class="manual-models-list">
                    <div v-for="modelId in group.modelIds" :key="modelId" class="manual-model-item">
                      <span class="model-id">{{ modelId }}</span>
                      <Button size="small" variant="ghost" @click="removeManualModel(group, modelId)">
                        <i class="fa-solid fa-times"></i>
                      </Button>
                    </div>
                  </div>
                  <p class="helper-text">
                    {{ t('extensionsBuiltin.modelRandomizer.manualModelHelp') }}
                  </p>
                </div>
                <div v-else-if="loadingModels" class="loading-placeholder">
                  <span>{{ t('common.loading') }}</span>
                </div>
              </FormItem>

              <FormItem :label="t('extensionsBuiltin.modelRandomizer.randomizeTemperature')">
                <Toggle :model-value="!!group.temperatureRange" @update:model-value="toggleTemperatureRange(group)" />
              </FormItem>

              <div v-if="group.temperatureRange" class="temperature-range">
                <FormItem :label="t('extensionsBuiltin.modelRandomizer.minTemperature')">
                  <RangeControl v-model="group.temperatureRange.min" :min="0" :max="2" :step="0.01" />
                </FormItem>

                <FormItem :label="t('extensionsBuiltin.modelRandomizer.maxTemperature')">
                  <RangeControl v-model="group.temperatureRange.max" :min="0" :max="2" :step="0.01" />
                </FormItem>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="empty-state">
          <p>{{ t('extensionsBuiltin.modelRandomizer.noGroups') }}</p>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <p>{{ t('extensionsBuiltin.modelRandomizer.noProfiles') }}</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.model-randomizer-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.profile-management {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.profile-controls {
  display: flex;
  gap: 0.5rem;

  .profile-select {
    flex: 1;
  }
}

.profile-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.profile-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: var(--black-30a);
  border-radius: var(--base-border-radius);
}

.groups-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;

  h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }
}

.groups-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.group-item {
  border: 1px solid var(--black-50a);
  border-radius: var(--base-border-radius);
  background: var(--black-20a);
  overflow: hidden;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover {
    background: var(--black-30a);
  }
}

.group-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;

  i {
    color: var(--theme-emphasis-color);
    transition: transform 0.2s ease;
  }

  .group-name {
    font-weight: 500;
  }

  .group-badge {
    padding: 0.25rem 0.5rem;
    background: var(--theme-underline-color);
    color: var(--theme-text-color);
    border-radius: 4px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .group-count {
    color: var(--theme-emphasis-color);
    font-size: 0.875rem;
  }
}

.group-details {
  padding: 1rem;
  border-top: 1px solid var(--black-50a);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.temperature-range {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--black-20a);
  border-radius: var(--base-border-radius);
}

.helper-text {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--theme-emphasis-color);
  font-style: italic;
}

.manual-model-input {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  .input-group {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .manual-models-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--black-20a);
    border-radius: var(--base-border-radius);
    max-height: 200px;
    overflow-y: auto;
  }

  .manual-model-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem;
    background: var(--black-30a);
    border-radius: var(--base-border-radius);

    .model-id {
      font-family: var(--font-family-mono);
      font-size: 0.875rem;
      color: var(--theme-text-color);
    }
  }
}

.loading-placeholder {
  padding: 0.75rem;
  text-align: center;
  color: var(--theme-emphasis-color);
  background: var(--black-20a);
  border-radius: var(--base-border-radius);
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--theme-emphasis-color);
  background: var(--black-20a);
  border-radius: var(--base-border-radius);
  border: 1px dashed var(--black-50a);

  p {
    margin: 0;
  }
}
</style>
