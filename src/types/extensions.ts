import type { ExtensionAPI } from './ExtensionAPI';

export interface ExtensionManifest {
  name: string;
  display_name: string;
  version?: string;
  author?: string;
  description?: string;
  loading_order?: number;
  requires?: string[]; // extras modules
  dependencies?: string[]; // other extensions
  minimum_client_version?: string;
  js?: string;
  css?: string;
  auto_update?: boolean;
  icon?: string;
}

export interface ExtensionPrompt {
  value: string;
  position: number;
  depth: number;
  scan: boolean;
  filter: () => boolean | Promise<boolean>;
}

export interface BuiltInExtensionModule {
  manifest: ExtensionManifest;
  /**
   * Called when the extension is enabled.
   * @param api The scoped API instance for this extension.
   * @returns A cleanup function to run when disabled (remove DOM nodes, listeners).
   */
  activate: (api: ExtensionAPI) => void | (() => void) | Promise<void | (() => void)>;
}
