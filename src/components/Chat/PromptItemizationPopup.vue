<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import type { ItemizedPrompt, PromptTokenBreakdown, WorldInfoEntry } from '../../types';
import { Button } from '../UI';

const props = defineProps<{
  data: ItemizedPrompt;
}>();

const { t } = useStrictI18n();
const showRaw = ref(false);
const showWorldInfo = ref(false);

const bd = computed<PromptTokenBreakdown>(() => props.data.breakdown);
const wiEntries = computed(() => props.data.worldInfoEntries || {});
const hasWiEntries = computed(() => Object.keys(wiEntries.value).length > 0);

const rawMessages = computed(() => {
  return props.data.messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
});

// Calculate Percentages for the Bar Chart
const percentages = computed(() => {
  const total = bd.value.promptTotal || 1;
  return {
    system: ((bd.value.systemTotal / total) * 100).toFixed(2),
    history: ((bd.value.chatHistory / total) * 100).toFixed(2),
    description: ((bd.value.description / total) * 100).toFixed(2),
    personality: ((bd.value.personality / total) * 100).toFixed(2),
    scenario: ((bd.value.scenario / total) * 100).toFixed(2),
    worldInfo: ((bd.value.worldInfo / total) * 100).toFixed(2),
    examples: ((bd.value.examples / total) * 100).toFixed(2),
    // Helper for the main buckets used in the graph
    graphSystem: ((bd.value.systemTotal / total) * 100).toFixed(2), // Basic System
    graphWI: ((bd.value.worldInfo / total) * 100).toFixed(2),
    graphHistory: ((bd.value.chatHistory / total) * 100).toFixed(2),

    // Remaining (Extensions, etc)
    graphOther: (((bd.value.extensions + bd.value.bias) / total) * 100).toFixed(2),
  };
});

function copyPrompt() {
  navigator.clipboard.writeText(rawMessages.value).then(() => {});
}

function toggleRaw() {
  showRaw.value = !showRaw.value;
}

function toggleWorldInfo() {
  showWorldInfo.value = !showWorldInfo.value;
}

function getEntryState(entry: WorldInfoEntry) {
  if (entry.constant) return { label: 'Constant', class: 'constant' };
  return { label: 'Normal', class: 'normal' };
}

// Helper to format token count
const fmt = (n: number) => n.toLocaleString();
</script>

<template>
  <div class="prompt-itemization">
    <div class="pi-header">
      <div>
        <strong>{{ t('chat.itemization.apiModel') }}:</strong> {{ data.api }} / {{ data.model }}
      </div>
      <div>
        <small
          ><strong>{{ t('chat.itemization.preset') }}:</strong> {{ data.presetName }}</small
        >
        <span class="separator">|</span>
        <small
          ><strong>{{ t('chat.itemization.tokenizer') }}:</strong> {{ data.tokenizer }}</small
        >
      </div>
    </div>

    <p class="pi-disclaimer">{{ t('chat.itemization.disclaimer') }}</p>

    <hr />

    <div class="pi-content">
      <!-- Bar Chart -->
      <div class="pi-graph-section">
        <div class="pi-graph-bar">
          <div class="pi-bar-segment system" :style="{ height: percentages.graphSystem + '%' }" title="System"></div>
          <div class="pi-bar-segment wi" :style="{ height: percentages.graphWI + '%' }" title="World Info"></div>
          <div
            class="pi-bar-segment history"
            :style="{ height: percentages.graphHistory + '%' }"
            title="Chat History"
          ></div>
          <div class="pi-bar-segment other" :style="{ height: percentages.graphOther + '%' }" title="Other"></div>
        </div>
      </div>

      <!-- Details -->
      <div class="pi-details-section">
        <!-- System Column -->
        <div class="pi-column">
          <div class="pi-row header system">
            <span>{{ t('chat.itemization.systemInfo') }}</span>
            <span>{{ fmt(bd.systemTotal) }}</span>
          </div>
          <div class="pi-row sub">
            <span>-- {{ t('chat.itemization.description') }}</span>
            <span>{{ fmt(bd.description) }}</span>
          </div>
          <div class="pi-row sub">
            <span>-- {{ t('chat.itemization.personality') }}</span>
            <span>{{ fmt(bd.personality) }}</span>
          </div>
          <div class="pi-row sub">
            <span>-- {{ t('chat.itemization.scenario') }}</span>
            <span>{{ fmt(bd.scenario) }}</span>
          </div>
          <div class="pi-row sub">
            <span>-- {{ t('chat.itemization.examples') }}</span>
            <span>{{ fmt(bd.examples) }}</span>
          </div>
          <div class="pi-row sub">
            <span>-- {{ t('chat.itemization.persona') }}</span>
            <span>{{ fmt(bd.persona) }}</span>
          </div>
        </div>

        <!-- Middle Column -->
        <div class="pi-column">
          <div class="pi-row header wi">
            <span>{{ t('chat.itemization.worldInfo') }}</span>
            <span>{{ fmt(bd.worldInfo) }}</span>
          </div>
          <div class="pi-row header history">
            <span>{{ t('chat.itemization.chatHistory') }}</span>
            <span>{{ fmt(bd.chatHistory) }}</span>
          </div>
          <div class="pi-row header other">
            <span>{{ t('chat.itemization.extensions') }}</span>
            <span>{{ fmt(bd.extensions) }}</span>
          </div>
          <div class="pi-row header bias">
            <span>{{ t('chat.itemization.bias') }}</span>
            <span>{{ fmt(bd.bias) }}</span>
          </div>
        </div>
      </div>
    </div>

    <hr />

    <div class="pi-footer">
      <div class="pi-stat">
        <span>{{ t('chat.itemization.totalTokens') }}:</span>
        <strong>{{ fmt(bd.promptTotal) }}</strong>
      </div>
      <div class="pi-stat">
        <span>{{ t('chat.itemization.maxContext') }}:</span>
        <strong>{{ fmt(bd.maxContext) }}</strong>
      </div>
    </div>

    <!-- Actions -->
    <div class="pi-actions">
      <Button icon="fa-square-poll-horizontal" @click="toggleRaw">
        {{ t('chat.itemization.showRaw') }}
      </Button>
      <Button v-if="hasWiEntries" icon="fa-book-journal-whills" @click="toggleWorldInfo">
        {{ t('chat.itemization.showWorldInfo') }}
      </Button>
      <Button icon="fa-copy" @click="copyPrompt">
        {{ t('chat.itemization.copy') }}
      </Button>
    </div>

    <!-- Raw Prompt Viewer -->
    <div v-show="showRaw" class="pi-raw-viewer">
      <pre>{{ rawMessages }}</pre>
    </div>

    <!-- WI Viewer -->
    <div v-show="showWorldInfo" class="pi-wi-viewer">
      <div v-for="(entries, book) in wiEntries" :key="book" class="pi-wi-book">
        <h4>{{ book }}</h4>
        <ul>
          <li v-for="entry in entries" :key="entry.uid">
            <div class="pi-wi-entry-header">
              <span class="uid">[{{ entry.uid }}]</span>
              <span class="title">{{ entry.comment || 'Untitled' }}</span>
              <span class="badge" :class="getEntryState(entry).class">{{ getEntryState(entry).label }}</span>
            </div>
            <div class="pi-wi-keys">
              <small>{{ entry.key.join(', ') }}</small>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
