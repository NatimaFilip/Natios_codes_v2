# Architecture

## Stack rationale — the "lean trio" + PostCSS

No bundler-framework (no Vite/Webpack). Each tool does one job, composed by npm scripts:

| Tool | Job | Why |
| ---- | --- | --- |
| **sass** (CLI) | Compile SCSS → CSS + sourcemap | Native Dart Sass, fast, first-class `@use` module system. |
| **postcss** + **postcss-cli** | Run the PostCSS plugin chain | Thin runner; reads `.browserslistrc` automatically. |
| **autoprefixer** | Add vendor prefixes | **This is why PostCSS is in the stack.** You write plain CSS; prefixes are derived from `.browserslistrc`, so they stay correct as browser support shifts — never hand-written, never stale. |
| **cssnano** | Minify CSS | Runs last in the PostCSS chain (default preset). |
| **esbuild** | Bundle + minify JS, emit sourcemap | One fast step for vanilla-JS bundling; no config file needed. |
| **npm-run-all** | Run watch tasks in parallel | `--parallel` keeps the four dev watchers alive together. |
| **chokidar** | Watch for added/removed files & folders | Drives entry regeneration in `npm run dev`. |
| **ssh2-sftp-client** | Upload built files to Shoptet over SFTP | Shoptet uses SFTP (SSH, port 22), not FTP/FTPS. Pushes file bytes directly, so the gitignored `dist/` needs no public URL. |

ESM throughout (`"type":"module"`), Node 20. The one CommonJS file is
`postcss.config.cjs` — postcss-cli loads its config with `require()`, so it must
stay `.cjs`.

## Generator / auto-discovery design

`scripts/generate-entries.mjs` is the heart of the "never maintain import lists"
requirement. It walks `src/scss` and `src/js`, applies the ordering rule, and
writes the two entry files with an `AUTO-GENERATED — DO NOT EDIT` header. Both
entries are gitignored.

- **SCSS** — globs `src/scss/**/_*.scss` (partials only). For each, emits
  `@use '<path>' as <ns>;` where `<path>` is the relative path **without** the
  leading `_` and `.scss`, and `<ns>` is that path with `/` replaced by `__`
  (double underscore). The double-underscore namespace avoids collisions with
  folders that contain a single underscore, e.g. `landing_page` →
  `landing_page__index` (never confused with a `landing/page` split). The entry
  references **no members** — it exists only to trigger CSS emission in a
  deterministic order.
- **JS** — globs `src/js/**/*.js` excluding the generated `main.js`. Emits
  `import * as <id> from './<relpath>';`, collects every namespace into a
  `modules` array, and on `DOMContentLoaded` calls `mod.init?.()` for each.
  Modules that export `init()` run automatically; modules without it are still
  bundled (for side effects). `<id>` is derived from the path and de-duplicated.

The generator is resilient to directories disappearing mid-walk (a `readdir`
failure yields an empty list rather than crashing), which matters in watch mode.

## Convention-based ordering rule

No hardcoded per-project folder list to maintain:

1. **Foundation folders first**, in this exact order if present:
   `base` → `layout` → `components`.
2. Then **every other** discovered top-level folder, **alphabetically**.
3. Within any folder (any depth), files **alphabetically**.

New folders need **no code change** — they slot in after the foundations,
alphabetically. The only constant in the script is the foundation array
`['base','layout','components']`, which encodes the convention, not your specific
pages.

## Shared variables

The Sass module system isolates members per file. The generated `main.scss`
controls **inclusion and emission ORDER only** — it does **not** make variables
or mixins globally visible.

> **Rule:** any partial that needs a shared variable/mixin must `@use` it itself.

```scss
// components/_buttons.scss
@use 'base/variables' as vars;

.btn {
  background: vars.$color-primary;
  padding: vars.$space-sm vars.$space-md;
}
```

These `@use 'base/variables'` paths resolve via the sass **load path**
(`--load-path=src/scss`, set in the `css:compile` / `dev:css:compile` scripts), so
`base/variables` means `src/scss/base/_variables.scss` from **any** partial,
regardless of how deep it is nested. Do **not** rely on the generated entry to
expose `vars.$x` to your partials — it won't.

## The sass → postcss sourcemap chain

```
src/scss/*.scss
   │  sass --source-map
   ▼
dist/main.css  +  dist/main.css.map      (map → original .scss)
   │  postcss --map   (autoprefixer + cssnano)
   ▼
dist/main.min.css  +  dist/main.min.css.map
```

Because `css:compile` emits `main.css.map` and `css:process` runs postcss with
`--map`, PostCSS **consumes** the incoming map and rewrites it, so the final
`dist/main.min.css.map` points all the way back to the original `.scss` sources
(verified: its `sources` array lists `../src/scss/.../_*.scss`). `dist/main.css`
is only an intermediate; the **deployed/previewed** files are `main.min.css` and
`main.min.js`.

JS is simpler: esbuild emits `dist/main.min.js` + `.map` directly from the
generated `src/js/main.js`.

## Cache busting — manual, by design

The deploy uploads `main.min.css` / `main.min.js` to **fixed** filenames and
overwrites them in place each push. The `<link>`/`<script>` tags live in each
store's admin "HTML code" tab (`common-header` for CSS, `common-footer` for JS),
pasted once by hand, carrying a `?v=N` you bump manually to force browsers to
refetch.

`scripts/deploy.mjs` still computes a **10-char sha1 of each file's CONTENT** and
logs it — purely as a *reference* so you can tell whether the bytes actually
changed since your last `?v=` bump. The `?v=` value itself is yours to set; the
hash is informational only.

> **Why no Shoptet API for this?** A deliberate operational-safety choice. If the
> tags were injected via the API (e.g. `/api/template-include`), then an API
> outage, an expired/revoked token, or an addon problem could leave you unable to
> change or remove styles/scripts on the live store. Keeping the tags in the GUI
> means the live site is always editable by hand, independent of any automation.
> The trade-off — a manual `?v=` bump per visible release — is accepted.

After uploading, the script **prints the exact tags** (`guiTags()`), so first-time
setup is copy-paste from the deploy log.

## Multi-store fan-out

One build is uploaded to **N stores**. Stores are defined in a single env var,
`STORES_JSON` — a JSON array of `{ name, ftpHost, ftpPort?, ftpUser, ftpPass,
ftpKeyPath? }`. `resolveStores()` parses and validates it (required fields present;
`ftpHost` is a bare hostname, not a URL), defaulting `ftpPort` to 22. If
`STORES_JSON` is absent, it falls back to the legacy single-store `FTP_*` env vars.

Design choices (all deliberate):

- **One config var, not N×secrets.** Adding a store is appending one object to the
  array — no workflow edit, no new secret, no code change. Each store carries its
  **own** SFTP credentials, so tenants are isolated.
- **Build once, fan out.** The bundle is produced a single time; `main()` then
  loops the stores, doing the SFTP upload per store with that store's credentials.
- **Continue-on-error, fail at end.** A store that throws (bad creds, unreachable
  host) is logged and recorded, and the loop moves on — one broken tenant never
  blocks the others. After the loop, the script prints an `N/total uploaded`
  summary and exits non-zero if **any** store failed, so CI still goes red and you
  see exactly which stores need attention.

> **Resolved decision — transfer = SFTP** (SSH, port 22). The API-only
> `POST /api/system/file` route was rejected: it fetches from a public `sourceUrl`,
> unworkable with a gitignored `dist/`. SFTP pushes bytes directly.
