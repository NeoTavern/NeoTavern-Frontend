<script setup lang="ts">
import { computed, ref } from 'vue';
import { EmptyState } from '../../../../components/common';
import Pagination from '../../../../components/common/Pagination.vue';
import type { EventMeaningResult, FateQuestion, FateRollResult, MythicExtensionAPI, MythicOdds } from '../types';

interface Props {
  api: MythicExtensionAPI;
}

const props = defineProps<Props>();
const t = props.api.i18n.t;

const actionHistory = computed(() => props.api.chat.metadata.get()?.extra?.actionHistory ?? []);
const reversedHistory = computed(() => actionHistory.value.slice().reverse());

const pageSize = 10;
const currentPage = ref(1);
const totalPages = computed(() => Math.ceil(reversedHistory.value.length / pageSize));
const paginatedHistory = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  const end = start + pageSize;
  return reversedHistory.value.slice(start, end);
});

type DisplayAction = {
  analysis?: {
    questions?: FateQuestion[];
    extracted_question?: string;
    odds?: MythicOdds;
    justification?: string;
  };
  fateRollResults?: FateRollResult[];
  fateRollResult?: FateRollResult;
  randomEvents?: EventMeaningResult[];
  randomEvent?: EventMeaningResult;
};

function getOutcomeClass(outcome: string) {
  if (outcome.startsWith('Exceptional')) return 'outcome-exceptional';
  if (outcome === 'Yes') return 'outcome-yes';
  if (outcome === 'No') return 'outcome-no';
  return '';
}

function formatOutcome(outcome: string) {
  return outcome;
}

function getQuestions(action: DisplayAction): FateQuestion[] {
  if (action.analysis?.questions) return action.analysis.questions;
  if (!action.analysis?.extracted_question) return [];
  return [
    {
      extracted_question: action.analysis.extracted_question,
      odds: action.analysis.odds ?? '50/50',
      justification: action.analysis.justification ?? '',
    },
  ];
}

function getRolls(action: DisplayAction): FateRollResult[] {
  if (action.fateRollResults) return action.fateRollResults;
  return action.fateRollResult ? [action.fateRollResult] : [];
}

function getRandomEvents(action: DisplayAction): EventMeaningResult[] {
  if (action.randomEvents) return action.randomEvents;
  return action.randomEvent ? [action.randomEvent] : [];
}

function getJustification(action: DisplayAction) {
  return action.analysis?.justification ?? '';
}
</script>

<template>
  <div class="log">
    <EmptyState
      v-if="reversedHistory.length === 0"
      :description="t('extensionsBuiltin.mythicAgents.panel.noHistoryRecorded')"
    />
    <div v-for="(action, index) in paginatedHistory" :key="index" class="log-card">
      <div v-for="(question, questionIndex) in getQuestions(action)" :key="questionIndex" class="question-block">
        <div class="log-header">
          <span class="question">{{ question.extracted_question }}</span>
          <span class="odds-badge">{{ question.odds }}</span>
        </div>

        <div v-if="getRolls(action)[questionIndex]" class="log-body">
          <div class="roll-info">
            <div class="roll-detail">
              <span class="label">{{ t('extensionsBuiltin.mythicAgents.panel.roll') }}:</span>
              <span class="value">{{ getRolls(action)[questionIndex].roll }}</span>
            </div>
            <div class="roll-detail">
              <span class="label">{{ t('extensionsBuiltin.mythicAgents.panel.chaosDie') }}:</span>
              <span class="value">{{ getRolls(action)[questionIndex].chaosDie }}</span>
            </div>
          </div>

          <div :class="['outcome-display', getOutcomeClass(getRolls(action)[questionIndex].outcome)]">
            {{ formatOutcome(getRolls(action)[questionIndex].outcome) }}
          </div>
        </div>
      </div>

      <div
        v-for="(randomEvent, eventIndex) in getRandomEvents(action)"
        :key="`event-${eventIndex}`"
        class="random-event"
      >
        <div class="event-header">
          <i class="fas fa-bolt"></i> {{ t('extensionsBuiltin.mythicAgents.panel.randomEvent') }}
        </div>
        <div class="event-content">
          <span class="focus">{{ randomEvent.focus }}</span>
          <span class="separator">•</span>
          <span class="action">{{ randomEvent.action }}</span>
          <span class="subject">{{ randomEvent.subject }}</span>
        </div>
      </div>

      <div v-if="getJustification(action)" class="justification">
        <i class="fas fa-info-circle"></i> {{ getJustification(action) }}
      </div>
    </div>
    <Pagination
      v-if="totalPages > 1"
      :total-items="reversedHistory.length"
      :current-page="currentPage"
      :items-per-page="pageSize"
      @update:current-page="currentPage = $event"
    />
  </div>
</template>

<style lang="scss" scoped>
.log {
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.log-card {
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.question-block {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.question-block + .question-block {
  border-top: 1px solid var(--theme-border-color);
  padding-top: var(--spacing-sm);
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-sm);
  border-bottom: 1px solid var(--theme-border-color);
  padding-bottom: var(--spacing-sm);
}

.question {
  font-weight: 600;
  color: var(--theme-text-color);
  line-height: 1.4;
}

.odds-badge {
  font-size: 0.75em;
  background-color: var(--black-50a);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--theme-emphasis-color);
  white-space: nowrap;
}

.log-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.roll-info {
  display: flex;
  gap: var(--spacing-md);
  font-size: 0.9em;
  color: var(--theme-emphasis-color);
}

.roll-detail {
  display: flex;
  gap: 6px;
}

.roll-detail .value {
  color: var(--theme-text-color);
  font-family: var(--font-family-mono);
}

.outcome-display {
  font-weight: bold;
  font-size: 1.1em;
  text-transform: uppercase;
  letter-spacing: 0.5px;

  &.outcome-yes {
    color: var(--color-accent-green);
  }
  &.outcome-no {
    color: var(--color-accent-red);
  }
  &.outcome-exceptional {
    color: var(--color-golden);
    text-shadow: 0 0 5px rgba(248, 211, 0, 0.3);
  }
}

.random-event {
  background-color: rgba(248, 211, 0, 0.1);
  border: 1px solid rgba(248, 211, 0, 0.3);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-sm);
  margin-top: var(--spacing-xs);

  .action {
    margin-right: 4px;
  }
}

.event-header {
  font-size: 0.85em;
  color: var(--color-golden);
  font-weight: bold;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.event-content {
  font-size: 0.95em;
}

.separator {
  margin: 0 6px;
  opacity: 0.5;
}

.justification {
  font-size: 0.85em;
  color: var(--theme-emphasis-color);
  font-style: italic;
  margin-top: 4px;
  display: flex;
  gap: 6px;
  align-items: flex-start;

  i {
    margin-top: 3px;
  }
}
</style>
