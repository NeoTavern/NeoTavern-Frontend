export interface UsageLogEntry {
  id: string;
  source: string; // 'core' or extension ID
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  timestamp: number;
  duration?: number;
  context?: string;
}

export interface UsageTrackerSettings {
  captureFullPayloads: boolean;
  captureStorageLimitBytes: number;
}

export interface UsageCaptureEntry {
  id: string;
  generationId: string;
  messageIndex?: number;
  chatFile?: string;
  source: string;
  model: string;
  timestamp: number;
  request: unknown;
  response?: unknown;
  responseText?: string;
  status: 'pending' | 'complete' | 'aborted' | 'error';
  sizeBytes: number;
}

export interface UsageStats {
  totalInput: number;
  totalOutput: number;
  totalRequests: number;
  byModel: Record<string, { input: number; output: number; requests: number }>;
  bySource: Record<string, { input: number; output: number; requests: number }>;
}

export type TimeRange = '5m' | '15m' | '1h' | '4h' | '12h' | '24h' | '7d' | '30d' | '90d' | 'all';

export interface LogFilter {
  search?: string;
  models?: string[];
  sources?: string[];
}

export type SortField = 'timestamp' | 'totalTokens' | 'duration';
export type SortOrder = 'asc' | 'desc';
export type ViewMode = 'chart' | 'table' | 'captures';

export interface UsageChartPoint {
  timestamp: number;
  input: number;
  output: number;
}

export interface DashboardState {
  viewMode: ViewMode;
  timeRange: TimeRange;
  filters: LogFilter;
  sortField: SortField;
  sortOrder: SortOrder;
  itemsPerPage: number;
}

export const STORE_NAME = 'NeoTavern_UsageTracker';
export const DEFAULT_SETTINGS: UsageTrackerSettings = {
  captureFullPayloads: true,
  captureStorageLimitBytes: 50 * 1024 * 1024,
};
