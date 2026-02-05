<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '../../../../components/UI';
import {
  generateInitialScene as sceneManagerGenerateInitialScene,
  updateScene as sceneManagerUpdateScene,
} from '../scene-manager';
import type { MythicChatExtraData, MythicExtensionAPI } from '../types';

interface Props {
  api: MythicExtensionAPI;
}

const props = defineProps<Props>();

const chatInfo = computed(() => props.api.chat.getChatInfo());
const extra = computed(
  () => chatInfo.value?.chat_metadata.extra?.['core.mythic-agents'] as MythicChatExtraData | undefined,
);
const scene = computed(() => extra.value?.scene);

async function generateInitialScene() {
  try {
    const newScene = await sceneManagerGenerateInitialScene(props.api);
    props.api.chat.metadata.update({
      extra: {
        'core.mythic-agents': {
          scene: newScene,
          chaos: newScene.chaos_rank,
        },
      },
    });
  } catch (error) {
    console.error('Failed to generate initial scene:', error);
  }
}

async function updateScene() {
  if (!scene.value) return;

  const oldChaos = scene.value.chaos_rank;

  try {
    const oldThreads = scene.value.threads || [];
    const updatedScene = await sceneManagerUpdateScene(props.api, scene.value);
    const newThreads = updatedScene.threads;
    const resolved = oldThreads.filter(
      (t) => !newThreads.some((nt) => nt.toLowerCase().trim() === t.toLowerCase().trim()),
    );
    props.api.chat.metadata.update({
      extra: {
        'core.mythic-agents': {
          scene: updatedScene,
          chaos: updatedScene.chaos_rank,
          resolved_threads: [...(extra.value?.resolved_threads || []), ...resolved],
        },
      },
    });

    if (updatedScene.chaos_rank !== oldChaos) {
      props.api.ui.showToast(
        `Chaos rank ${updatedScene.chaos_rank > oldChaos ? 'increased' : 'decreased'} to ${updatedScene.chaos_rank}`,
        'info',
      );
    }
  } catch (error) {
    console.error('Update scene error:', error);
    props.api.ui.showToast('Failed to update scene. Check console for details.', 'error');
  }
}
</script>

<template>
  <div class="scene">
    <div class="controls">
      <Button block class="action-btn" @click="generateInitialScene"> <i class="fas fa-film"></i> New Scene </Button>
      <Button block :disabled="!scene" class="action-btn" @click="updateScene">
        <i class="fas fa-sync"></i> Update Scene
      </Button>
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
            {{ scene.characters.filter((c) => !['pc', 'player'].includes(c.type.toLowerCase())).length }}
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
