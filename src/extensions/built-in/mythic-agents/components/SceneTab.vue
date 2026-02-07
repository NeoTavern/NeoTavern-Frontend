<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Checkbox } from '../../../../components/UI';
import { useMythicState } from '../composables/useMythicState';
import { generateInitialScene as sceneManagerGenerateInitialScene } from '../scene-manager';
import type { MythicExtensionAPI } from '../types';

interface Props {
  api: MythicExtensionAPI;
}

const props = defineProps<Props>();

const extra = useMythicState(props.api);
const scene = computed(() => extra.value?.scene);
const activeNpcCount = computed(() => scene.value?.characters.length || 0);

const loading = ref(false);
const abortController = ref<AbortController | null>(null);
const generateIdentities = ref(true);

async function generateInitialScene() {
  if (loading.value) {
    abortController.value?.abort();
    return;
  }

  loading.value = true;
  abortController.value = new AbortController();

  try {
    const newScene = await sceneManagerGenerateInitialScene(
      props.api,
      abortController.value.signal,
      generateIdentities.value,
    );
    const history = props.api.chat.getHistory();
    if (history.length === 0) return;
    const lastMsg = history[history.length - 1];
    const currentExtra = lastMsg.extra?.['core.mythic-agents'];
    const newExtra = {
      ...currentExtra,
      scene: newScene,
      chaos: newScene.chaos_rank,
    };
    lastMsg.extra = {
      ...lastMsg.extra,
      'core.mythic-agents': newExtra,
    };
    props.api.chat.updateMessageObject(history.length - 1, {
      extra: lastMsg.extra,
    });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'AbortError') {
      console.error('Failed to generate initial scene:', error);
    }
  } finally {
    loading.value = false;
    abortController.value = null;
  }
}
</script>

<template>
  <div class="scene">
    <div class="controls">
      <Checkbox v-model="generateIdentities" label="Let LLM generate character identities" />
      <Button block class="action-btn" @click="generateInitialScene">
        <i :class="loading ? 'fas fa-stop' : 'fas fa-film'"></i>{{ loading ? 'Abort' : 'Reinitialize Scene' }}</Button
      >
    </div>

    <div class="section-header">Current Scene Details</div>

    <div v-if="scene" class="scene-details">
      <div class="detail-card">
        <div class="detail-icon"><i class="fas fa-dice-d20"></i></div>
        <div class="detail-content">
          <div class="label">Chaos Rank</div>
          <div class="value">{{ scene.chaos_rank }}</div>
        </div>
      </div>

      <div class="detail-card">
        <div class="detail-icon"><i class="fas fa-users"></i></div>
        <div class="detail-content">
          <div class="label">Active NPCs</div>
          <div class="value">
            {{ activeNpcCount }}
          </div>
        </div>
      </div>

      <div class="detail-card">
        <div class="detail-icon"><i class="fas fa-list-ul"></i></div>
        <div class="detail-content">
          <div class="label">Open Threads</div>
          <div class="value">{{ scene.threads.length }}</div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <i class="fas fa-ghost"></i>
      <p>No scene data available. Start a new scene to begin.</p>
    </div>
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

.empty-state {
  text-align: center;
  padding: var(--spacing-xl);
  color: var(--theme-emphasis-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
  background-color: var(--black-30a);
  border-radius: var(--base-border-radius);

  i {
    font-size: 2rem;
    opacity: 0.5;
  }

  p {
    margin: 0;
  }
}
</style>
