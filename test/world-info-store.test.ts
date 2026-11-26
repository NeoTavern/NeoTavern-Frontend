import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/api/world-info';
import { useWorldInfoStore } from '../src/stores/world-info.store';

vi.mock('../src/composables/useStrictI18n', () => ({
  useStrictI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../src/api/world-info', () => ({
  listAllWorldInfoBooks: vi.fn(async () => []),
  fetchWorldInfoBook: vi.fn(),
  saveWorldInfoBook: vi.fn(async () => {}),
  deleteWorldInfoBook: vi.fn(async () => {}),
  importWorldInfoBook: vi.fn(async () => ({ name: 'Town' })),
}));

describe('world info store deleteBook', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('writes a pending save before the delete, so the save cannot bring the book back', async () => {
    const order: string[] = [];
    vi.mocked(api.saveWorldInfoBook).mockImplementation(async () => void order.push('save'));
    vi.mocked(api.deleteWorldInfoBook).mockImplementation(async () => void order.push('delete'));

    const store = useWorldInfoStore();
    const fileId = (await store.createBook('Town'))!;
    await store.createEntry(fileId);
    await store.deleteBook(fileId);
    await vi.runAllTimersAsync();

    expect(order).toEqual(['save', 'delete']);
  });
});
