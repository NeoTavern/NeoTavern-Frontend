import type { ExtensionManifest } from '../types';

export async function discoverExtensions(): Promise<{ name: string; type: string }[]> {
  const response = await fetch('/api/extensions/discover');
  if (!response.ok) {
    throw new Error('Failed to discover extensions');
  }
  return response.json();
}

export async function fetchManifest(extensionName: string): Promise<ExtensionManifest> {
  const response = await fetch(`/scripts/extensions/${extensionName}/manifest.json`);
  if (!response.ok) {
    throw new Error(`Could not load manifest.json for ${extensionName}`);
  }
  return response.json();
}
