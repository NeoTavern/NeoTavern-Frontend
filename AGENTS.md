# NeoTavern - Role-Playing AI Chat Platform

NeoTavern is a modern, extensible Vue.js/TypeScript web app for AI-driven role-playing (RP) chats. Features character management, multi-model LLM integrations (via API providers), world-info, personas, extensions, i18n, and responsive UI (drawers, sidebars, toasts).

Built with Vue 3, Pinia, Vite, SCSS, vue-i18n.

## Setup Commands

```
npm install
npm run build     # Production build
npm run lint:fix  # Lint (ESLint + TS) and fix
npm run format    # Format (Prettier)
npm test          # Run tests
```

- Node: ^18+.

## Dev Environment Tips

- **Key Dirs**:
  - `src/components/`: UI .
  - `src/stores/`: Pinia.
  - `src/services/`: Logic.
  - `src/types/`: TS defs.
  - `src/extensions/built-in/`: Extensions.
  - `src/styles/components/`: SCSS per-component.
  - `locales/en.json`: i18n keys.

- **i18n**: Add keys to `locales/en.json`

## Code Style

- **TS Strict**: `strict: true` (no implicit any).
- **SCSS**: Scoped per-component (`src/styles/components/`), vars in `_variables.scss`. No semicolons? Std.
- **Naming**: Kebab-case files, camelCase vars/funcs. Single quotes.
- **Functional**: Prefer composables over Options API.
- **i18n**: `t('key')`; tooltips in locales.
- **Types**: Augment `src/types/`; avoid `any`.

ESLint/Prettier: Run `npm run lint --fix`.

## Testing Instructions

- Tests in `test/` folder.
- Run: `npm test` / `npm vitest <file>`.
- After significance of changes, run these commands. However please avoid running them for each change. Run them once after all changes are done.
  1. `npm run format`
  2. `npm run lint:fix`
  3. `npm test`
- Fix TS errors, add/update tests for changes.
- Search TODO/FIXME: `rg 'TODO|FIXME' src/`.
