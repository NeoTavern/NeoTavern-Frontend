<script setup lang="ts">
import { computed, ref } from 'vue';
import { EmptyState } from '../../../../components/common';
import { Button, Checkbox } from '../../../../components/UI';
import { useMythicState } from '../composables/useMythicState';
import { generateInitialScene as sceneManagerGenerateInitialScene } from '../scene-manager';
import type { MythicExtensionAPI } from '../types';

interface Props {
  api: MythicExtensionAPI;
}

const props = defineProps<Props>();
const t = props.api.i18n.t;

const { state: extra, upsertLatestOrLastExtra } = useMythicState(props.api);
const scene = computed(() => extra.value?.scene);
const activeNpcCount = computed(() => scene.value?.characters.length || 0);

const loading = ref(false);
const abortController = ref<AbortController | null>(null);
const activeRequestId = ref(0);
const generateIdentities = ref(true);
const actionButtonLabel = computed(() => {
  if (loading.value) return t('common.abort');
  return t('extensionsBuiltin.mythicAgents.panel.reinitializeScene');
});

async function generateInitialScene() {
  if (loading.value) {
    const controller = abortController.value;
    activeRequestId.value += 1;
    loading.value = false;
    abortController.value = null;
    controller?.abort();
    props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.sceneAbortRequested'), 'info');
    return;
  }

  loading.value = true;
  abortController.value = new AbortController();
  const requestId = activeRequestId.value + 1;
  activeRequestId.value = requestId;
  const signal = abortController.value.signal;

  try {
    const newScene = await sceneManagerGenerateInitialScene(props.api, signal, generateIdentities.value);
    if (signal.aborted || requestId !== activeRequestId.value) return;

    upsertLatestOrLastExtra({
      scene: newScene,
      chaos: newScene.chaos_rank,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.sceneAborted'), 'info');
    } else {
      console.error('Failed to generate initial scene:', error);
    }
  } finally {
    if (requestId === activeRequestId.value) {
      loading.value = false;
      abortController.value = null;
    }
  }
}
</script>

<template>
  <div class="scene">
    <div class="controls">
      <Checkbox v-model="generateIdentities" :label="t('extensionsBuiltin.mythicAgents.panel.generateIdentities')" />
      <Button block class="action-btn" @click="generateInitialScene">
        <i :class="loading ? 'fas fa-stop' : 'fas fa-film'"></i>
        {{ actionButtonLabel }}
      </Button>
    </div>

    <div class="section-header">{{ t('extensionsBuiltin.mythicAgents.panel.currentSceneDetails') }}</div>

    <div v-if="scene" class="scene-details">
      <div class="detail-card">
        <div class="detail-icon"><i class="fas fa-dice-d20"></i></div>
        <div class="detail-content">
          <div class="label">{{ t('extensionsBuiltin.mythicAgents.panel.chaosRank') }}</div>
          <div class="value">{{ scene.chaos_rank }}</div>
        </div>
      </div>

      <div class="detail-card">
        <div class="detail-icon"><i class="fas fa-users"></i></div>
        <div class="detail-content">
          <div class="label">{{ t('extensionsBuiltin.mythicAgents.panel.activeNpcs') }}</div>
          <div class="value">
            {{ activeNpcCount }}
          </div>
        </div>
      </div>

      <div class="detail-card">
        <div class="detail-icon"><i class="fas fa-list-ul"></i></div>
        <div class="detail-content">
          <div class="label">{{ t('extensionsBuiltin.mythicAgents.panel.openThreads') }}</div>
          <div class="value">{{ scene.threads.length }}</div>
        </div>
      </div>
    </div>

    <EmptyState v-else icon="fa-ghost" :description="t('extensionsBuiltin.mythicAgents.panel.noSceneData')" />
  </div>
</template>

<style lang="scss" scoped>
.scene {
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.controls {
  display: flex;
  gap: var(--spacing-md);
}

.action-btn {
  flex: 1;
}

.section-header {
  font-size: 0.9em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--theme-emphasis-color);
  font-weight: 600;
  border-bottom: 1px solid var(--theme-border-color);
  padding-bottom: var(--spacing-xs);
}

.scene-details {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.detail-card {
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-md);
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
}

.detail-icon {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--black-50a);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  color: var(--theme-emphasis-color);
}

.detail-content {
  flex: 1;
}

.label {
  font-size: 0.85em;
  color: var(--theme-emphasis-color);
  margin-bottom: 2px;
}

.value {
  font-size: 1.2rem;
  font-weight: bold;
  color: var(--theme-text-color);
}
</style>
