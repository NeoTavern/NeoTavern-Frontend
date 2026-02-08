<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '../../../../components/UI';
import { POPUP_RESULT, POPUP_TYPE } from '../../../../types/popup';
import { useMythicState } from '../composables/useMythicState';
import { type MythicExtensionAPI } from '../types';

interface Props {
  api: MythicExtensionAPI;
}

const props = defineProps<Props>();

const { state: extra, getLatestMythicMessageIndex } = useMythicState(props.api);
const chaos = computed(() => extra.value?.chaos ?? 5);
const scene = computed(() => extra.value?.scene);
const actionHistory = computed(() => props.api.chat.metadata.get()?.extra?.actionHistory ?? []);
const npcCount = computed(() => scene.value?.characters.length);

function adjustChaos(delta: number) {
  const mythicIndex = getLatestMythicMessageIndex();
  if (mythicIndex === null) return;
  const history = props.api.chat.getHistory();
  const msg = history[mythicIndex];
  const currentExtra = msg.extra?.['core.mythic-agents'];
  if (!currentExtra) return;
  const newChaos = Math.max(1, Math.min(9, (currentExtra.chaos ?? 5) + delta));
  const newScene = currentExtra.scene ? { ...currentExtra.scene, chaos_rank: newChaos } : undefined;
  const newExtra = {
    ...currentExtra,
    chaos: newChaos,
    scene: newScene,
  };
  msg.extra = {
    ...msg.extra,
    'core.mythic-agents': newExtra,
  };
  props.api.chat.updateMessageObject(mythicIndex, {
    extra: msg.extra,
  });
}

function resetAll() {
  props.api.ui
    .showPopup({
      title: 'Reset Mythic Agents',
      content: 'This will clear all mythic agents data (chaos, scene, action history, etc.). Are you sure?',
      type: POPUP_TYPE.CONFIRM,
    })
    .then((result) => {
      if (result.result === POPUP_RESULT.AFFIRMATIVE) {
        const mythicIndex = getLatestMythicMessageIndex();
        if (mythicIndex === null) return;
        const history = props.api.chat.getHistory();
        const msg = history[mythicIndex];
        const resetExtra = {
          actionHistory: [],
          chaos: 5,
          scene: {
            chaos_rank: 5,
            characters: [],
            threads: [],
          },
        };
        msg.extra = {
          ...msg.extra,
          'core.mythic-agents': resetExtra,
        };
        props.api.chat.updateMessageObject(mythicIndex, {
          extra: msg.extra,
        });
        // Clear mythic extras from other messages
        for (let i = 0; i < history.length - 1; i++) {
          const msg = history[i];
          if (msg.extra?.['core.mythic-agents']) {
            props.api.chat.updateMessageObject(i, {
              extra: {
                ...msg.extra,
                'core.mythic-agents': undefined,
              },
            });
          }
        }
      }
    });
}

function getOutcomeClass(outcome: string) {
  if (outcome.startsWith('Exceptional')) return 'outcome-exceptional';
  if (outcome === 'Yes') return 'outcome-yes';
  if (outcome === 'No') return 'outcome-no';
  return '';
}

function formatOutcome(outcome: string) {
  return outcome;
}
</script>

<template>
  <div class="dashboard">
    <!-- Chaos Control -->
    <div class="chaos-section">
      <div class="section-header">Chaos Rank</div>
      <div class="chaos-control">
        <Button class="chaos-btn" :disabled="chaos <= 1" @click="adjustChaos(-1)">
          <i class="fas fa-minus"></i>
        </Button>
        <div class="chaos-display">
          <span class="chaos-value">{{ chaos }}</span>
        </div>
        <Button class="chaos-btn" :disabled="chaos >= 9" @click="adjustChaos(1)">
          <i class="fas fa-plus"></i>
        </Button>
        <Button class="chaos-btn reset-btn" @click="resetAll">
          <i class="fas fa-undo"></i>
        </Button>
      </div>
      <div class="chaos-description">
        {{ chaos >= 5 ? 'High Chaos: Expect the unexpected.' : 'Low Chaos: Things are calm.' }}
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">
          {{ npcCount }}
        </div>
        <div class="stat-label">NPCs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ scene?.threads.length || 0 }}</div>
        <div class="stat-label">Threads</div>
      </div>
    </div>

    <!-- Recent Actions -->
    <div class="recent-activity">
      <div class="section-header">Recent Actions</div>
      <div v-if="actionHistory.length === 0" class="empty-state">No actions recorded yet.</div>
      <ul v-else class="activity-list">
        <li v-for="(action, index) in actionHistory.slice().reverse().slice(0, 5)" :key="index" class="activity-item">
          <div class="activity-main">
            <span class="question">{{ action.analysis.extracted_question }}</span>
            <span
              v-if="action.fateRollResult"
              :class="['outcome-badge', getOutcomeClass(action.fateRollResult.outcome)]"
            >
              {{ formatOutcome(action.fateRollResult.outcome) }}
            </span>
          </div>
          <div v-if="action.randomEvent" class="activity-event">
            <i class="fas fa-bolt"></i> {{ action.randomEvent.focus }}
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.dashboard {
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.section-header {
  font-size: 0.9em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--theme-emphasis-color);
  margin-bottom: var(--spacing-sm);
  font-weight: 600;
}

/* Chaos Section */
.chaos-section {
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-md);
  text-align: center;
}

.chaos-control {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-lg);
  margin: var(--spacing-sm) 0;
}

.chaos-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chaos-value {
  font-size: 3rem;
  font-weight: bold;
  line-height: 1;
  color: var(--theme-text-color);
}

.chaos-description {
  font-size: 0.85em;
  color: var(--theme-emphasis-color);
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md);
}

.stat-card {
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-md);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: bold;
  color: var(--theme-text-color);
}

.stat-label {
  font-size: 0.85em;
  color: var(--theme-emphasis-color);
}

/* Activity List */
.activity-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.activity-item {
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-sm) var(--spacing-md);
}

.activity-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-sm);
}

.question {
  font-weight: 500;
  font-size: 0.95em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outcome-badge {
  font-size: 0.8em;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: var(--grey-5050a);
  color: var(--white-90a);
  white-space: nowrap;

  &.outcome-yes {
    background-color: var(--color-accent-green-70a);
    color: var(--white-100);
  }

  &.outcome-no {
    background-color: var(--color-accent-crimson-70a);
    color: var(--white-100);
  }
}

.activity-event {
  margin-top: 4px;
  font-size: 0.85em;
  color: var(--color-golden);
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-state {
  text-align: center;
  color: var(--theme-emphasis-color);
  font-style: italic;
  padding: var(--spacing-md);
}
</style>
