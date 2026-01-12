<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Button, Input, Select } from '../../../components/UI';
import { Pagination } from '../../../components/common';
import { POPUP_TYPE, type ExtensionAPI } from '../../../types';
import { UsageStorage } from './storage';
import type {
  DashboardState,
  LogFilter,
  SortField,
  SortOrder,
  TimeRange,
  UsageChartPoint,
  UsageLogEntry,
  UsageStats,
  ViewMode,
} from './types';

// TODO: i18n

const props = defineProps<{
  api: ExtensionAPI;
  storage: UsageStorage;
}>();

// --- Types & Constants ---

const rangeOptions: { label: string; value: TimeRange }[] = [
  { label: 'Last 5 Minutes', value: '5m' },
  { label: 'Last 15 Minutes', value: '15m' },
  { label: 'Last 1 Hour', value: '1h' },
  { label: 'Last 4 Hours', value: '4h' },
  { label: 'Last 12 Hours', value: '12h' },
  { label: 'Last 24 Hours', value: '24h' },
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 30 Days', value: '30d' },
  { label: 'Last 90 Days', value: '90d' },
  { label: 'All Time', value: 'all' },
];

const sortOptions: { label: string; value: SortField }[] = [
  { label: 'Date', value: 'timestamp' },
  { label: 'Total Tokens', value: 'totalTokens' },
  { label: 'Duration', value: 'duration' },
];

const sortOrderOptions: { label: string; value: SortOrder }[] = [
  { label: 'Desc', value: 'desc' },
  { label: 'Asc', value: 'asc' },
];

// --- State ---
const activeRange = ref<TimeRange>('24h');
const viewMode = ref<ViewMode>('chart');
const loading = ref(false);

// Stats & Data
const stats = ref<UsageStats | null>(null);
const logs = ref<UsageLogEntry[]>([]);
const chartPoints = ref<UsageChartPoint[]>([]);
const totalLogs = ref(0);

// Filters & Pagination
const currentPage = ref(1);
const itemsPerPage = ref(10);
const searchQuery = ref('');
const filterModels = ref<string[]>([]);
const filterSources = ref<string[]>([]);
const sortField = ref<SortField>('timestamp');
const sortOrder = ref<SortOrder>('desc');

// --- Computed ---

const availableModels = computed(() => {
  if (!stats.value) return [];
  return Object.keys(stats.value.byModel).map((m) => ({ label: m, value: m }));
});

const availableSources = computed(() => {
  if (!stats.value) return [];
  return Object.keys(stats.value.bySource).map((s) => ({ label: s, value: s }));
});

const sortedModels = computed(() => {
  if (!stats.value) return [];
  return Object.entries(stats.value.byModel).sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output));
});

const sortedSources = computed(() => {
  if (!stats.value) return [];
  return Object.entries(stats.value.bySource).sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output));
});

// --- Methods ---

const formatNumber = (num: number) => new Intl.NumberFormat().format(num);

function getFilter(): LogFilter {
  return {
    search: searchQuery.value,
    models: filterModels.value.length ? filterModels.value : undefined,
    sources: filterSources.value.length ? filterSources.value : undefined,
  };
}

async function loadStats() {
  stats.value = await props.storage.getStats(activeRange.value, getFilter());
}

async function loadChartData() {
  if (viewMode.value !== 'chart') return;
  chartPoints.value = await props.storage.getChartData(activeRange.value, getFilter());
}

async function loadLogs() {
  if (viewMode.value !== 'table') return;

  const result = await props.storage.getLogs(
    activeRange.value,
    currentPage.value,
    itemsPerPage.value,
    getFilter(),
    sortField.value,
    sortOrder.value,
  );
  logs.value = result.items;
  totalLogs.value = result.total;
}

async function refresh() {
  loading.value = true;
  try {
    await loadStats();
    if (viewMode.value === 'chart') {
      await loadChartData();
    } else {
      await loadLogs();
    }
  } finally {
    loading.value = false;
  }
}

async function clearLogs() {
  const popupResult = await props.api.ui.showPopup({
    type: POPUP_TYPE.CONFIRM,
    title: 'Clear All Usage Data',
    content: 'Are you sure you want to clear all usage logs? This action cannot be undone.',
  });
  if (popupResult.result) {
    await props.storage.clearLogs();
    currentPage.value = 1;
    await refresh();
  }
}

// --- State Persistence ---

let saveStateTimeout: number | undefined;

function saveDashboardState() {
  clearTimeout(saveStateTimeout);
  saveStateTimeout = window.setTimeout(() => {
    const state: DashboardState = {
      viewMode: viewMode.value,
      timeRange: activeRange.value,
      filters: {
        search: searchQuery.value,
        models: filterModels.value.length ? filterModels.value : undefined,
        sources: filterSources.value.length ? filterSources.value : undefined,
      },
      sortField: sortField.value,
      sortOrder: sortOrder.value,
      itemsPerPage: itemsPerPage.value,
    };
    props.storage.saveState(state).catch((err) => console.error('[UsageTracker] Failed to save state:', err));
  }, 500);
}

async function loadDashboardState() {
  try {
    const state = await props.storage.getState();
    if (state) {
      viewMode.value = state.viewMode;
      activeRange.value = state.timeRange;
      searchQuery.value = state.filters.search || '';
      filterModels.value = state.filters.models || [];
      filterSources.value = state.filters.sources || [];
      sortField.value = state.sortField;
      sortOrder.value = state.sortOrder;
      itemsPerPage.value = state.itemsPerPage || 10;
      currentPage.value = 1;
    } else {
      // Legacy fallback
      const savedMode = props.api.settings.get('viewMode');
      if (savedMode && (savedMode === 'chart' || savedMode === 'table')) {
        viewMode.value = savedMode as ViewMode;
      }
    }
  } catch (err) {
    console.error('[UsageTracker] Failed to load state:', err);
  }
}

// --- Watchers ---

// Combined watcher for state changes
watch(
  [viewMode, activeRange, searchQuery, filterModels, filterSources, sortField, sortOrder, itemsPerPage, currentPage],
  () => {
    saveDashboardState();
  },
  { deep: true },
);

watch(activeRange, () => {
  currentPage.value = 1;
  refresh();
});

watch(viewMode, () => {
  refresh();
});

watch([currentPage, itemsPerPage, sortField, sortOrder], () => {
  if (viewMode.value === 'table') loadLogs();
});

watch([filterModels, filterSources], () => {
  currentPage.value = 1;
  refresh();
});

// Debounced search for data refresh
let searchRefreshTimeout: number;
watch(searchQuery, () => {
  clearTimeout(searchRefreshTimeout);
  searchRefreshTimeout = window.setTimeout(() => {
    currentPage.value = 1;
    refresh();
  }, 300);
});

onMounted(async () => {
  await loadDashboardState();
  await refresh();
});

// --- Chart Helpers ---

function getBarWidth(value: number, total: number) {
  if (total === 0) return '0%';
  return `${Math.max(1, (value / total) * 100)}%`;
}

// Simple SVG Line Chart Logic
const chartContainer = ref<HTMLElement | null>(null);
const chartWidth = 800;
const chartHeight = 250;
const padding = { top: 20, right: 20, bottom: 30, left: 50 };

const chartPathInput = computed(() => {
  if (!chartPoints.value.length) return '';
  return createPath(chartPoints.value, (p) => p.input, 'input');
});

const chartPathOutput = computed(() => {
  if (!chartPoints.value.length) return '';
  return createPath(chartPoints.value, (p) => p.output, 'output');
});

const maxChartValue = computed(() => {
  if (!chartPoints.value.length) return 0;
  return Math.max(...chartPoints.value.map((p) => Math.max(p.input, p.output)));
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createPath(data: UsageChartPoint[], getValue: (p: UsageChartPoint) => number, _type: 'input' | 'output') {
  if (data.length < 2) return '';

  const maxY = maxChartValue.value || 1;
  const minX = data[0].timestamp;
  const maxX = data[data.length - 1].timestamp;
  const rangeX = maxX - minX || 1;

  const getX = (ts: number) => {
    return padding.left + ((ts - minX) / rangeX) * (chartWidth - padding.left - padding.right);
  };

  const getY = (val: number) => {
    return (
      chartHeight - padding.bottom - (val / maxY) * (chartHeight - padding.top - padding.bottom) // Invert Y
    );
  };

  let d = `M ${getX(data[0].timestamp)} ${getY(getValue(data[0]))}`;
  for (let i = 1; i < data.length; i++) {
    d += ` L ${getX(data[i].timestamp)} ${getY(getValue(data[i]))}`;
  }
  return d;
}

const chartXLabels = computed(() => {
  if (!chartPoints.value.length) return [];
  // Show ~5 labels
  const count = 5;
  const step = Math.ceil(chartPoints.value.length / count);
  return chartPoints.value
    .filter((_, i) => i % step === 0 || i === chartPoints.value.length - 1)
    .map((p) => {
      let labelText = '';
      const date = new Date(p.timestamp);
      // Format based on range
      if (['5m', '15m', '1h', '4h', '12h', '24h'].includes(activeRange.value)) {
        labelText = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      } else {
        labelText = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      return {
        x:
          padding.left +
          ((p.timestamp - chartPoints.value[0].timestamp) /
            (chartPoints.value[chartPoints.value.length - 1].timestamp - chartPoints.value[0].timestamp || 1)) *
            (chartWidth - padding.left - padding.right),
        y: chartHeight - 10,
        text: labelText,
      };
    });
});

const chartYLabels = computed(() => {
  const max = maxChartValue.value;
  const count = 5;
  const labels = [];
  for (let i = 0; i <= count; i++) {
    const val = (max / count) * i;
    labels.push({
      x: 5,
      y: chartHeight - padding.bottom - (val / (max || 1)) * (chartHeight - padding.top - padding.bottom),
      text: val >= 1000 ? (val / 1000).toFixed(1) + 'k' : Math.round(val),
    });
  }
  return labels;
});
</script>

<template>
  <div class="usage-dashboard">
    <!-- Header / Global Controls -->
    <div class="dashboard-header">
      <div class="header-left">
        <Select v-model="activeRange" :options="rangeOptions" class="range-select" title="Time Range" />
        <div class="view-toggles">
          <Button
            :variant="viewMode === 'chart' ? 'default' : 'ghost'"
            icon="fa-chart-area"
            title="Chart View"
            @click="viewMode = 'chart'"
          />
          <Button
            :variant="viewMode === 'table' ? 'default' : 'ghost'"
            icon="fa-list"
            title="Logs View"
            @click="viewMode = 'table'"
          />
        </div>
      </div>
      <div class="header-right">
        <Button icon="fa-rotate" title="Refresh" variant="ghost" @click="refresh" />
        <Button
          icon="fa-trash-can"
          title="Clear Logs"
          variant="danger"
          :disabled="!stats || stats.totalRequests === 0"
          @click="clearLogs"
        >
          Clear Data
        </Button>
      </div>
    </div>

    <!-- Filters Toolbar (Shared) -->
    <div class="filters-toolbar fadeIn">
      <Input v-model="searchQuery" placeholder="Search context or model..." class="search-input" />
      <Select
        v-model="filterModels"
        :options="availableModels"
        multiple
        placeholder="All Models"
        class="filter-select"
        searchable
      />
      <Select
        v-model="filterSources"
        :options="availableSources"
        multiple
        placeholder="All Sources"
        class="filter-select"
        searchable
      />
      <!-- Sort controls only relevant for Table view, but maybe useful for list logic in future -->
      <div v-if="viewMode === 'table'" class="sort-controls">
        <Select v-model="sortField" :options="sortOptions" class="sort-select" title="Sort By" />
        <Select v-model="sortOrder" :options="sortOrderOptions" class="sort-order" title="Order" />
      </div>
    </div>

    <!-- Summary Cards (Always Visible, reflects filters) -->
    <div v-if="stats" class="summary-cards">
      <div class="card">
        <div class="card-label">Requests</div>
        <div class="card-value">{{ formatNumber(stats.totalRequests) }}</div>
      </div>
      <div class="card">
        <div class="card-label">Input Tokens</div>
        <div class="card-value">{{ formatNumber(stats.totalInput) }}</div>
      </div>
      <div class="card">
        <div class="card-label">Output Tokens</div>
        <div class="card-value">{{ formatNumber(stats.totalOutput) }}</div>
      </div>
      <div class="card total">
        <div class="card-label">Total Tokens</div>
        <div class="card-value">{{ formatNumber(stats.totalInput + stats.totalOutput) }}</div>
      </div>
    </div>

    <!-- Content Area -->
    <div class="content-area">
      <!-- CHART VIEW -->
      <div v-if="viewMode === 'chart'" class="chart-view fadeIn">
        <!-- Time Series Chart -->
        <div class="chart-container-wrapper card-base">
          <h3>Token Usage Over Time</h3>
          <div v-if="chartPoints.length > 1" ref="chartContainer" class="svg-container">
            <svg :viewBox="`0 0 ${chartWidth} ${chartHeight}`" preserveAspectRatio="none" class="usage-chart">
              <!-- Grid Lines -->
              <g class="grid">
                <line
                  v-for="label in chartYLabels"
                  :key="'grid-' + label.y"
                  :x1="padding.left"
                  :y1="label.y"
                  :x2="chartWidth - padding.right"
                  :y2="label.y"
                  stroke="var(--white-10a)"
                />
              </g>

              <!-- Paths -->
              <path :d="chartPathInput" fill="none" stroke="var(--color-warning-amber)" stroke-width="2" />
              <path :d="chartPathOutput" fill="none" stroke="var(--color-accent-green)" stroke-width="2" />

              <!-- Legend (Overlay) -->
              <g transform="translate(60, 20)">
                <rect width="10" height="10" fill="var(--color-warning-amber)" />
                <text x="15" y="9" fill="currentColor" font-size="10">Input</text>
                <rect x="60" width="10" height="10" fill="var(--color-accent-green)" />
                <text x="75" y="9" fill="currentColor" font-size="10">Output</text>
              </g>

              <!-- Labels -->
              <g class="labels">
                <text
                  v-for="(label, i) in chartXLabels"
                  :key="'x-' + i"
                  :x="label.x"
                  :y="label.y"
                  text-anchor="middle"
                  fill="var(--theme-emphasis-color)"
                  font-size="10"
                >
                  {{ label.text }}
                </text>
                <text
                  v-for="(label, i) in chartYLabels"
                  :key="'y-' + i"
                  :x="label.x"
                  :y="label.y + 4"
                  text-anchor="start"
                  fill="var(--theme-emphasis-color)"
                  font-size="10"
                >
                  {{ label.text }}
                </text>
              </g>
            </svg>
          </div>
          <div v-else class="empty-chart">Not enough data to display graph for this period.</div>
        </div>

        <div class="charts-row">
          <!-- By Model -->
          <div class="chart-section card-base">
            <h3>Usage by Model</h3>
            <div class="chart-list">
              <div v-for="[model, s] in sortedModels" :key="model" class="chart-item">
                <div class="chart-info">
                  <span class="chart-label" :title="model">{{ model }}</span>
                  <span class="chart-details">
                    {{ formatNumber(s.input + s.output) }}
                  </span>
                </div>
                <div class="progress-bar-container">
                  <div
                    class="progress-bar input"
                    :style="{ width: getBarWidth(s.input, s.input + s.output) }"
                    :title="'Input: ' + formatNumber(s.input)"
                  ></div>
                  <div
                    class="progress-bar output"
                    :style="{ width: getBarWidth(s.output, s.input + s.output) }"
                    :title="'Output: ' + formatNumber(s.output)"
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <!-- By Source -->
          <div class="chart-section card-base">
            <h3>Usage by Source</h3>
            <div class="chart-list">
              <div v-for="[source, s] in sortedSources" :key="source" class="chart-item">
                <div class="chart-info">
                  <span class="chart-label">{{ source }}</span>
                  <span class="chart-details">
                    {{ formatNumber(s.input + s.output) }}
                  </span>
                </div>
                <div class="progress-bar-container">
                  <div
                    class="progress-bar input"
                    :style="{ width: getBarWidth(s.input, s.input + s.output) }"
                    :title="'Input: ' + formatNumber(s.input)"
                  ></div>
                  <div
                    class="progress-bar output"
                    :style="{ width: getBarWidth(s.output, s.input + s.output) }"
                    :title="'Output: ' + formatNumber(s.output)"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TABLE VIEW -->
      <div v-else class="table-view fadeIn">
        <div class="logs-table-wrapper">
          <table class="logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Model</th>
                <th>Context</th>
                <th class="text-right">In</th>
                <th class="text-right">Out</th>
                <th class="text-right">Total</th>
                <th class="text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading">
                <td colspan="8" class="text-center">Loading...</td>
              </tr>
              <tr v-else-if="logs.length === 0">
                <td colspan="8" class="text-center">No logs found matching filters.</td>
              </tr>
              <tr v-for="log in logs" :key="log.id">
                <td>{{ new Date(log.timestamp).toLocaleString() }}</td>
                <td>
                  <span class="badge source">{{ log.source }}</span>
                </td>
                <td :title="log.model">{{ log.model }}</td>
                <td :title="log.context">{{ log.context || '-' }}</td>
                <td class="text-right">{{ formatNumber(log.inputTokens) }}</td>
                <td class="text-right">{{ formatNumber(log.outputTokens) }}</td>
                <td class="text-right font-bold">{{ formatNumber(log.totalTokens) }}</td>
                <td class="text-right">{{ log.duration ? (log.duration / 1000).toFixed(1) + 's' : '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Pagination v-model:current-page="currentPage" v-model:items-per-page="itemsPerPage" :total-items="totalLogs" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.usage-dashboard {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  container-type: inline-size;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 15px;

  .header-left {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .header-right {
    display: flex;
    gap: 10px;
  }

  @container (max-width: 600px) {
    justify-content: center;

    .header-left,
    .header-right {
      justify-content: center;
    }
  }
}

.range-select {
  width: 180px;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 15px;
}

.card {
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: 15px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  .card-label {
    font-size: 0.9em;
    color: var(--theme-emphasis-color);
    margin-bottom: 5px;
  }

  .card-value {
    font-size: 1.5em;
    font-weight: bold;
  }

  &.total {
    background-color: var(--color-accent-cobalt-30a);
    border-color: var(--color-info-cobalt);
  }
}

.card-base {
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: 15px;
}

/* Shared Filters */
.filters-toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  background-color: var(--black-30a);
  padding: 10px;
  border-radius: var(--base-border-radius);
  border: 1px solid var(--theme-border-color);

  .search-input {
    flex: 1;
    min-width: 200px;
  }

  .filter-select {
    width: 150px;
  }

  .sort-controls {
    display: flex;
    gap: 5px;

    .sort-select {
      width: 140px;
    }

    .sort-order {
      width: 80px;
    }
  }
}

/* --- Chart View Styles --- */
.chart-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.chart-container-wrapper {
  h3 {
    margin-top: 0;
    margin-bottom: 15px;
    font-size: 1.1em;
  }
}

.svg-container {
  width: 100%;
  height: 250px;
}

.usage-chart {
  width: 100%;
  height: 100%;
}

.empty-chart {
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--theme-emphasis-color);
  font-style: italic;
}

.charts-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}

.chart-section {
  h3 {
    margin-top: 0;
    margin-bottom: 15px;
    font-size: 1.1em;
    border-bottom: 1px solid var(--theme-border-color);
    padding-bottom: 5px;
  }
}

.chart-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chart-item {
  font-size: 0.9em;

  .chart-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .chart-label {
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 70%;
  }

  .chart-details {
    color: var(--theme-emphasis-color);
  }
}

.progress-bar-container {
  display: flex;
  height: 8px;
  background-color: var(--black-50a);
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  &.input {
    background-color: var(--color-warning-amber);
  }
  &.output {
    background-color: var(--color-accent-green);
  }
}

/* --- Table View Styles --- */
.table-view {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.logs-table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
}

.logs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
  background-color: var(--black-30a);

  th,
  td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid var(--theme-border-color);
  }

  th {
    background-color: var(--black-50a);
    font-weight: 600;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr:hover {
    background-color: var(--white-20a);
  }

  .text-right {
    text-align: right;
  }

  .text-center {
    text-align: center;
  }

  .font-bold {
    font-weight: bold;
  }
}

.badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.85em;
  text-transform: uppercase;
  font-weight: 600;

  &.source {
    background-color: var(--grey-5050a);
  }
}

/* Animations */
.fadeIn {
  animation: fadeIn 0.3s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
