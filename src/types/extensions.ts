import type { ExtensionAPI } from './ExtensionAPI';
import type { I18nKey } from './i18n';

export interface ExtensionManifest {
  name: string;
  display_name: I18nKey;
  version?: string;
  author?: string;
  description: I18nKey;
  loading_order?: number;
  requires?: string[]; // extras modules
  dependencies?: string[]; // other extensions
  minimum_client_version?: string;
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
  /**
   * Normalizes stored settings (fills defaults, upgrades old shapes). Runs before `activate`
   * and its result is written back, so the extension can read its settings as-is afterwards.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  migrateSettings?: (settings: any) => Record<string, unknown>;
}
