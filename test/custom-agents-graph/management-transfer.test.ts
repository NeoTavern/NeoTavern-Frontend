import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { GraphPreset, JsonObject, JsonValue } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { GraphEditorStore } from '../../src/extensions/built-in/custom-agents/editor/editor-store';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';
import {
  addInstalledPreset,
  createGraphPreset,
  deleteInstalledPreset,
  duplicateInstalledPreset,
  installGraphTemplate,
  renameInstalledPreset,
  replaceInstalledPreset,
  setInstalledPresetEnabled,
} from '../../src/extensions/built-in/custom-agents/settings/management';
import { exportGraphPreset, importGraphPreset } from '../../src/extensions/built-in/custom-agents/settings/transfer';
import {
  loadInstalledGraphAgents,
  validateInstalledGraphAgentsSettings,
  validateInstalledPreset,
} from '../../src/extensions/built-in/custom-agents/settings/store';
import { getGraphAgentTemplates } from '../../src/extensions/built-in/custom-agents/settings/catalog';

const fixture = (): GraphPreset =>
  JSON.parse(fs.readFileSync('test/fixtures/custom-agents/minimal-observer.flow.json', 'utf8')) as GraphPreset;

function asObject(value: JsonValue | undefined): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value;
}

function mythic(): GraphPreset {
  return getGraphAgentTemplates()[0]!;
}

function configurationProperty(preset: GraphPreset, name: string): JsonObject {
  return asObject(asObject(preset.agent.configurationSchema.properties)[name]);
}

function eventFocusRows(preset: GraphPreset): JsonObject[] {
  const collections = asObject(preset.agent.configurationDefaults.tableCollections);
  const defaultCollection = asObject(collections.Default);
  const rows = defaultCollection.eventFocuses;
  if (!Array.isArray(rows)) throw new Error('Expected event focus rows');
  return rows.map(asObject);
}

describe('installed graph agent management and transfer', () => {
  it('installs immutable Mythic catalog data as a disabled editable exact-roundtrip copy', () => {
    const template = getGraphAgentTemplates()[0]!;
    expect(template.agent).toMatchObject({ id: 'builtin-mythic', name: 'Mythic GM Emulator', enabled: false });
    const pristine = structuredClone(template);
    template.agent.name = 'Mutated caller clone';
    expect(getGraphAgentTemplates()[0]).toEqual(pristine);

    const installed = installGraphTemplate({ presets: [] }, pristine).settings;
    installed.presets[0]!.agent.name = 'Editable installed copy';
    expect(getGraphAgentTemplates()[0]).toEqual(pristine);
    const source = exportGraphPreset({ presets: [pristine] }, pristine.agent.id);
    expect(importGraphPreset({ presets: [] }, source).settings.presets[0]).toEqual(pristine);
  }, 60_000);

  it('creates, duplicates, renames, enables, replaces, and deletes definitions with stable IDs', () => {
    const created = createGraphPreset('created-agent', 'Created agent');
    let settings = addInstalledPreset({ presets: [] }, created).settings;
    settings = duplicateInstalledPreset(settings, 'created-agent', 'copied-agent', 'Copied agent').settings;
    expect(settings.presets.map((preset) => preset.agent.id)).toEqual(['created-agent', 'copied-agent']);
    expect(settings.presets[1]!.agent.enabled).toBe(false);

    settings = renameInstalledPreset(settings, 'created-agent', 'Renamed agent').settings;
    settings = setInstalledPresetEnabled(settings, 'created-agent', true).settings;
    expect(settings.presets[0]!.agent).toMatchObject({ id: 'created-agent', name: 'Renamed agent', enabled: true });

    const replacement = structuredClone(settings.presets[0]!);
    replacement.agent.priority = 7;
    settings = replaceInstalledPreset(settings, 'created-agent', replacement).settings;
    expect(settings.presets[0]!.agent.priority).toBe(7);
    expect(() => {
      replacement.agent.id = 'changed-agent';
      replaceInstalledPreset(settings, 'created-agent', replacement);
    }).toThrow('stable');

    settings = deleteInstalledPreset(settings, 'created-agent').settings;
    expect(settings.presets.map((preset) => preset.agent.id)).toEqual(['copied-agent']);
  });

  it('keeps catalog inputs immutable while installing editable disabled copies', () => {
    const template = fixture();
    template.agent.enabled = true;
    const original = structuredClone(template);
    const installed = installGraphTemplate({ presets: [] }, template).settings;
    installed.presets[0]!.agent.name = 'Edited installed copy';
    expect(template).toEqual(original);
    expect(installed.presets[0]!.agent.enabled).toBe(false);
  });

  it('round-trips the exact complete envelope and excludes transient editor/run state by construction', () => {
    const preset = fixture();
    const settings = { presets: [preset] };
    const source = exportGraphPreset(settings, preset.agent.id);
    expect(JSON.parse(source)).toEqual(preset);
    const imported = importGraphPreset({ presets: [] }, source).settings;
    expect(imported.presets[0]).toEqual(preset);
    expect(source).not.toContain('runOverlay');
    expect(source).not.toContain('viewport');
    expect(source).not.toContain('selectedNode');
  });

  it('enforces own-key and contiguous-range values at import, install, load, export, and draft apply boundaries', () => {
    const missingSelection = mythic();
    missingSelection.agent.configurationDefaults.activeTableCollection = 'Missing';
    const gap = mythic();
    eventFocusRows(gap)[0]!.min = 2;
    const reordered = mythic();
    const collections = asObject(reordered.agent.configurationDefaults.tableCollections);
    asObject(collections.Default).eventFocuses = eventFocusRows(reordered).reverse();

    for (const invalid of [missingSelection, gap, reordered])
      expect(() => validateInstalledPreset(invalid)).toThrow('CONFIGURATION_DEFAULTS');
    expect(() => importGraphPreset({ presets: [] }, JSON.stringify(missingSelection))).toThrow(
      'CONFIGURATION_DEFAULTS',
    );
    expect(() =>
      loadInstalledGraphAgents({
        settings: { get: () => ({ presets: [missingSelection] }), set: vi.fn(), save: vi.fn() },
      }),
    ).toThrow('CONFIGURATION_DEFAULTS');
    expect(() => installGraphTemplate({ presets: [] }, gap)).toThrow('CONFIGURATION_DEFAULTS');
    expect(() => exportGraphPreset({ presets: [reordered] }, reordered.agent.id)).toThrow('CONFIGURATION_DEFAULTS');

    const executable = fixture();
    const apply = vi.fn();
    const editor = new GraphEditorStore({
      executable,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'unused-id' },
      apply,
    });
    editor.draft.value = missingSelection;
    editor.revalidate();
    expect(editor.canApply.value).toBe(false);
    expect(editor.apply()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  }, 60_000);

  it('rejects unsafe, malformed, absent-type, incompatible-type, reference, and invalid schema declarations', () => {
    const cases: Array<[string, (preset: GraphPreset) => void]> = [
      [
        'unsafe own-key path',
        (preset) => (configurationProperty(preset, 'activeTableCollection')['x-own-key-of'] = '__proto__.tables'),
      ],
      [
        'malformed own-key declaration',
        (preset) => (configurationProperty(preset, 'activeTableCollection')['x-own-key-of'] = 3),
      ],
      ['own-key without type', (preset) => delete configurationProperty(preset, 'activeTableCollection').type],
      [
        'own-key incompatible type',
        (preset) => (configurationProperty(preset, 'activeTableCollection').type = 'array'),
      ],
      [
        'unsafe range path',
        (preset) => {
          const collections = configurationProperty(preset, 'tableCollections');
          const entry = asObject(collections.additionalProperties);
          const ranges = asObject(asObject(asObject(entry.properties).eventFocuses)['x-contiguous-ranges']);
          ranges.minPath = 'constructor.min';
        },
      ],
      [
        'range minimum exceeds maximum',
        (preset) => {
          const collections = configurationProperty(preset, 'tableCollections');
          const entry = asObject(collections.additionalProperties);
          const ranges = asObject(asObject(asObject(entry.properties).eventFocuses)['x-contiguous-ranges']);
          ranges.minimum = 101;
        },
      ],
      [
        'range without exact array type',
        (preset) => {
          const collections = configurationProperty(preset, 'tableCollections');
          const entry = asObject(collections.additionalProperties);
          delete asObject(asObject(entry.properties).eventFocuses).type;
        },
      ],
      ['reference', (preset) => (configurationProperty(preset, 'activeTableCollection').$ref = '#/$defs/value')],
      ['$defs', (preset) => (preset.agent.configurationSchema.$defs = {})],
      ['invalid JSON Schema', (preset) => (configurationProperty(preset, 'activeTableCollection').type = 'invalid')],
    ];
    for (const [label, mutate] of cases) {
      const preset = mythic();
      mutate(preset);
      expect(() => validateInstalledPreset(preset), label).toThrow('AGENT_SCHEMA');
    }
  }, 60_000);

  it('rejects invalid configuration defaults and initial state through the shared catalog validator', () => {
    const invalidConfiguration = mythic();
    invalidConfiguration.agent.configurationDefaults = {};
    const invalidState = mythic();
    invalidState.agent.initialState = { initialized: 'not-boolean' };
    expect(() => validateInstalledPreset(invalidConfiguration)).toThrow('CONFIGURATION_DEFAULTS');
    expect(() => validateInstalledPreset(invalidState)).toThrow('INITIAL_STATE');
    expect(getGraphAgentTemplates()).toHaveLength(4);
  }, 60_000);

  it('prevalidates the whole payload and rejects duplicate ID or name without mutating settings', () => {
    const preset = fixture();
    const settings = validateInstalledGraphAgentsSettings({ presets: [preset] });
    const baseline = structuredClone(settings);

    expect(() => importGraphPreset(settings, JSON.stringify(preset))).toThrow('Duplicate agent ID');
    expect(() =>
      importGraphPreset(settings, JSON.stringify({ format: 'UNSUPPORTED_FORMAT', agent: preset.agent })),
    ).toThrow();
    const duplicateName = fixture();
    duplicateName.agent.id = 'different-id';
    expect(() => importGraphPreset(settings, JSON.stringify(duplicateName))).toThrow('Duplicate agent name');
    const invalid = structuredClone(duplicateName) as GraphPreset & { transient?: boolean };
    invalid.transient = true;
    expect(() => importGraphPreset(settings, JSON.stringify(invalid))).toThrow();
    const invalidView = structuredClone(duplicateName);
    invalidView.agent.views = [
      {
        id: 'invalid-view',
        title: 'Invalid view',
        root: {
          id: 'invalid-action',
          component: 'BUTTON',
          label: 'Run',
          action: { label: 'Run', workflowId: 'missing-manual-flow', input: {}, confirm: false },
        },
      },
    ];
    expect(() => importGraphPreset(settings, JSON.stringify(invalidView))).toThrow('VIEW_REFERENCE_INVALID');
    expect(settings).toEqual(baseline);
  });
});
