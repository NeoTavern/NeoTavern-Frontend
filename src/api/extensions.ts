import type { ExtensionManifest } from '../types';

// TODO: Create type for the response
export async function discoverExtensions(): Promise<{ name: string; type: string }[]> {
  // Mocked response for development. The real implementation is commented out below.
  console.log('Using mocked extension discovery');
  return Promise.resolve([
    // { name: 'example-button', type: 'local' },
    // { name: 'example-vue-component', type: 'local' },
    // { name: 'message-buttons', type: 'local' },
  ]);
  /*
  const response = await fetch('/api/extensions/discover');
  if (!response.ok) {
    throw new Error('Failed to discover extensions');
  }
  return response.json();
  */
}

export async function fetchManifest(extensionName: string): Promise<ExtensionManifest> {
  const response = await fetch(`/extensions/${extensionName}/manifest.json`);
  if (!response.ok) {
    throw new Error(`Could not load manifest.json for ${extensionName}`);
  }
  return response.json();
}
