import type { BuiltInExtensionModule } from '../../types/extensions';

// Find all index.ts files inside subdirectories of built-in
// eager: true ensures they are bundled, not lazy-loaded chunks
const modules = import.meta.glob<BuiltInExtensionModule>('./*/index.ts', { eager: true });

export const builtInExtensions: BuiltInExtensionModule[] = Object.values(modules);
