import fs from 'node:fs';
import type { GraphPreset } from '../../../src/extensions/built-in/custom-agents/graph/contracts';

// Paths are cwd-relative because import.meta.url is not a file URL under jsdom.
export function loadFlowFixture(name = 'minimal-observer'): GraphPreset {
  const path =
    name === 'mythic'
      ? 'src/extensions/built-in/custom-agents/presets/mythic.flow.json'
      : `test/fixtures/custom-agents/${name}.flow.json`;
  return JSON.parse(fs.readFileSync(path, 'utf8')) as GraphPreset;
}
