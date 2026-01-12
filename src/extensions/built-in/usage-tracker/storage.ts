import localforage from 'localforage';
import { uuidv4 } from '../../../utils/commons';
import {
  STORE_NAME,
  type DashboardState,
  type LogFilter,
  type SortField,
  type SortOrder,
  type TimeRange,
  type UsageChartPoint,
  type UsageLogEntry,
  type UsageStats,
} from './types';

export class UsageStorage {
  private logsStore: LocalForage;
  private stateStore: LocalForage;

  constructor() {
    this.logsStore = localforage.createInstance({
      name: STORE_NAME,
      storeName: 'logs',
      description: 'LLM Usage Logs',
    });

    this.stateStore = localforage.createInstance({
      name: STORE_NAME,
      storeName: 'state',
      description: 'Usage Tracker UI State',
    });
  }

  // --- State Management ---

  async saveState(state: DashboardState): Promise<void> {
    // We store the whole state object under a single key for simplicity
    await this.stateStore.setItem('dashboardState', state);
  }

  async getState(): Promise<DashboardState | null> {
    return await this.stateStore.getItem<DashboardState>('dashboardState');
  }

  // --- Logs Management ---

  async addLog(entry: Omit<UsageLogEntry, 'id' | 'totalTokens'>): Promise<UsageLogEntry> {
    const fullEntry: UsageLogEntry = {
      ...entry,
      id: uuidv4(),
      totalTokens: entry.inputTokens + entry.outputTokens,
    };
    // Key = `${timestamp}_${id}` for time-based ordering/filtering potential
    const key = `${fullEntry.timestamp}_${fullEntry.id}`;
    await this.logsStore.setItem(key, fullEntry);
    return fullEntry;
  }

  private getStartTime(range: TimeRange): number {
    const now = Date.now();
    switch (range) {
      case '5m':
        return now - 5 * 60 * 1000;
      case '15m':
        return now - 15 * 60 * 1000;
      case '1h':
        return now - 60 * 60 * 1000;
      case '4h':
        return now - 4 * 60 * 60 * 1000;
      case '12h':
        return now - 12 * 60 * 60 * 1000;
      case '24h':
        return now - 24 * 60 * 60 * 1000;
      case '7d':
        return now - 7 * 24 * 60 * 60 * 1000;
      case '30d':
        return now - 30 * 24 * 60 * 60 * 1000;
      case '90d':
        return now - 90 * 24 * 60 * 60 * 1000;
      case 'all':
        return 0;
      default:
        return 0;
    }
  }

  private isMatch(value: UsageLogEntry, filter?: LogFilter): boolean {
    if (!filter) return true;

    if (filter.models?.length) {
      if (!filter.models.includes(value.model)) return false;
    }

    if (filter.sources?.length) {
      if (!filter.sources.includes(value.source)) return false;
    }

    if (filter.search) {
      const lower = filter.search.toLowerCase();
      const contextMatch = value.context?.toLowerCase().includes(lower);
      const modelMatch = value.model.toLowerCase().includes(lower);
      if (!contextMatch && !modelMatch) return false;
    }

    return true;
  }

  /**
   * Retrieves logs with pagination, time filtering, search, and sorting.
   * Uses iterate to scan values.
   */
  async getLogs(
    range: TimeRange,
    page: number,
    pageSize: number,
    filter?: LogFilter,
    sortField: SortField = 'timestamp',
    sortOrder: SortOrder = 'desc',
  ): Promise<{ items: UsageLogEntry[]; total: number }> {
    const startTime = this.getStartTime(range);
    const matches: UsageLogEntry[] = [];

    await this.logsStore.iterate<UsageLogEntry, void>((value, key) => {
      // 1. Fast Time Check via Key
      const ts = parseInt(key.split('_')[0], 10);
      if (ts < startTime) return;

      // 2. Apply Filters
      if (this.isMatch(value, filter)) {
        matches.push(value);
      }
    });

    // 3. Sort
    matches.sort((a, b) => {
      let valA: number;
      let valB: number;

      switch (sortField) {
        case 'totalTokens':
          valA = a.totalTokens;
          valB = b.totalTokens;
          break;
        case 'duration':
          valA = a.duration || 0;
          valB = b.duration || 0;
          break;
        case 'timestamp':
        default:
          valA = a.timestamp;
          valB = b.timestamp;
          break;
      }

      return sortOrder === 'asc' ? valA - valB : valB - valA;
    });

    const total = matches.length;
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const items = matches.slice(startIdx, endIdx);

    return { items, total };
  }

  /**
   * Aggregates data for time-series charts.
   * Groups data into buckets suitable for the time range.
   */
  async getChartData(range: TimeRange, filter?: LogFilter): Promise<UsageChartPoint[]> {
    const startTime = this.getStartTime(range);
    const points: Record<number, UsageChartPoint> = {};

    // Determine bucket size (ms)
    let bucketSize = 0;
    switch (range) {
      case '5m':
        bucketSize = 10 * 1000; // 10s -> ~30 buckets
        break;
      case '15m':
        bucketSize = 30 * 1000; // 30s -> ~30 buckets
        break;
      case '1h':
        bucketSize = 2 * 60 * 1000; // 2m -> ~30 buckets
        break;
      case '4h':
        bucketSize = 10 * 60 * 1000; // 10m -> ~24 buckets
        break;
      case '12h':
        bucketSize = 30 * 60 * 1000; // 30m -> ~24 buckets
        break;
      case '24h':
        bucketSize = 60 * 60 * 1000; // 1h -> 24 buckets
        break;
      case '7d':
        bucketSize = 6 * 60 * 60 * 1000; // 6h -> 28 buckets
        break;
      case '30d':
        bucketSize = 24 * 60 * 60 * 1000; // 1d -> 30 buckets
        break;
      case '90d':
        bucketSize = 3 * 24 * 60 * 60 * 1000; // 3d -> 30 buckets
        break;
      case 'all':
      default:
        bucketSize = 24 * 60 * 60 * 1000; // 1d default
        break;
    }

    await this.logsStore.iterate<UsageLogEntry, void>((value, key) => {
      const ts = parseInt(key.split('_')[0], 10);
      if (ts < startTime) return;

      if (!this.isMatch(value, filter)) return;

      // Normalize timestamp to bucket
      const bucketTs = Math.floor(ts / bucketSize) * bucketSize;

      if (!points[bucketTs]) {
        points[bucketTs] = { timestamp: bucketTs, input: 0, output: 0 };
      }

      points[bucketTs].input += value.inputTokens;
      points[bucketTs].output += value.outputTokens;
    });

    // Convert to array and sort
    const result = Object.values(points).sort((a, b) => a.timestamp - b.timestamp);

    return result;
  }

  /**
   * Calculates statistics for a given time range.
   */
  async getStats(range: TimeRange, filter?: LogFilter): Promise<UsageStats> {
    const startTime = this.getStartTime(range);

    const stats: UsageStats = {
      totalInput: 0,
      totalOutput: 0,
      totalRequests: 0,
      byModel: {},
      bySource: {},
    };

    await this.logsStore.iterate<UsageLogEntry, void>((value, key) => {
      const ts = parseInt(key.split('_')[0], 10);
      if (ts < startTime) return;

      if (!this.isMatch(value, filter)) return;

      stats.totalInput += value.inputTokens;
      stats.totalOutput += value.outputTokens;
      stats.totalRequests++;

      // By Model
      if (!stats.byModel[value.model]) {
        stats.byModel[value.model] = { input: 0, output: 0, requests: 0 };
      }
      stats.byModel[value.model].input += value.inputTokens;
      stats.byModel[value.model].output += value.outputTokens;
      stats.byModel[value.model].requests++;

      // By Source
      const source = value.source || 'unknown';
      if (!stats.bySource[source]) {
        stats.bySource[source] = { input: 0, output: 0, requests: 0 };
      }
      stats.bySource[source].input += value.inputTokens;
      stats.bySource[source].output += value.outputTokens;
      stats.bySource[source].requests++;
    });

    return stats;
  }

  async clearLogs() {
    await this.logsStore.clear();
  }
}
