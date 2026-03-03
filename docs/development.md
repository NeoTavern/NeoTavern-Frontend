# Development

## Local dev overrides

For a custom proxy target, HTTPS, or Basic auth during `npm run dev` or `vite preview`, you can use an optional **local overrides file** that is gitignored and never committed.

1. Copy the example file:
   ```bash
   cp vite.config.local.example.ts vite.config.local.ts
   ```
2. Edit `vite.config.local.ts` and export `devOverrides` (or a default export) with your values.

**Shape:** See the `DevOverrides` interface and `defaultDevOverrides` in `vite-dev-overrides.ts`. You can override:

- **proxyTarget** — Backend URL for the dev/preview proxy (default: `http://localhost:8000`).
- **server** / **preview** — `port`, `host` for the Vite dev and preview servers.
- **https** — `certPath` and `keyPath` to PEM files; the main config reads them and sets `server.https` / `preview.https`.
- **auth** — `true` for Basic auth with any credentials; or `{ user, pass }` to validate; omit or `false` for no auth.

All logic (proxy path list, auth middleware, cert reading) lives in `vite.config.ts`; the local file only supplies values. Do not put secrets or real paths in the example file.
