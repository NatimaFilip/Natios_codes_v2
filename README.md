# Natios — Shoptet theme build & deploy pipeline

A frameworkless build pipeline for a Shoptet e-commerce theme. You write SCSS and
vanilla JS across as many files and folders as you like; the pipeline auto-discovers
everything, bundles into **one** minified, autoprefixed `main.min.css` and **one**
minified `main.min.js`, and uploads to **one or many** Shoptet stores via SFTP on
every push to `main`. Cache-busting is a manual `?v=N` you control in the admin.

No framework. No hosted server — **GitHub Actions is the backend.**

## Purpose

- **One CSS, one JS.** Many source files → two minified bundles.
- **Zero manual import lists.** A generator auto-discovers every SCSS partial and
  JS module and writes the entry files itself. You **never** edit `@use`/`import`
  lists, and **never** touch a config when you add a folder.
- **Automatic vendor prefixes.** You write plain CSS; Autoprefixer adds prefixes.
- **Push to deploy, to every store.** `git push` → Actions builds **once** → SFTP
  upload to **all** configured stores. (Tags live in the admin; you bump `?v=N`.)

## Prerequisites

- **Node 20** (`node --version` → v20.x). The pipeline uses ESM (`"type":"module"`).

## Install

```bash
npm install
```

## Scripts

| Script                  | What it does                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`           | Generate entries, then watch everything in parallel (the everyday workflow). |
| `npm run build`         | One-shot production build: generate → CSS (compile+process) → JS bundle.     |
| `npm run generate`      | Regenerate `src/scss/main.scss` and `src/js/main.js` once.                   |
| `npm run watch:entries` | Watch for added/removed files & folders and regenerate entries.              |
| `npm run build:css`     | `css:compile` (sass) then `css:process` (postcss).                           |
| `npm run build:js`      | esbuild bundle + minify JS.                                                  |
| `npm run deploy`        | SFTP upload to all stores (normally run by CI, not by hand).                 |

Sub-scripts (`css:compile`, `css:process`, `dev:*`) exist to compose the above.

## Manual deploy (when CI isn't an option)

Normally you just `git push` and GitHub Actions deploys. But you can deploy from
your own machine — handy when Actions is down, you're hotfixing, or testing before
committing. **A manual deploy does not need a commit or a push** — it reads the
built files from `dist/` and the credentials from your local `.env`.

**Prerequisites (one time):**

1. `npm install` — dependencies present.
2. Create `.env` from `.env.example` and fill in `STORES_JSON` (real SFTP hosts /
   users / passwords). `.env` is gitignored — it never leaves your machine.

**Deploy:**

```bash
npm run build      # 1. regenerate entries + bundle → dist/  (REQUIRED first;
                   #    deploy uploads whatever is in dist/, it does not build)
npm run deploy     # 2. SFTP-upload dist/ to every store in STORES_JSON
```

Or in one line: `npm run build && npm run deploy`.

What you'll see: the deploy connects to each store over SFTP, uploads the four
files to `/code_files/`, prints an `N/total uploaded` summary, and finally prints
the exact `<link>`/`<script>` tags to paste in the admin. It **exits non-zero if
any store fails** (e.g. a bad host), but still uploads to the stores that work — so
one misconfigured store won't block the others.

**Deploy to a single store** (e.g. to test one before the rest) — pass a one-store
`STORES_JSON` inline instead of using `.env`:

```bash
# PowerShell
$env:STORES_JSON='[{"name":"natima-cz","ftpHost":"REAL_HOST","ftpUser":"U","ftpPass":"P"}]'; npm run deploy

# bash / macOS / Linux
STORES_JSON='[{"name":"natima-cz","ftpHost":"REAL_HOST","ftpUser":"U","ftpPass":"P"}]' npm run deploy
```

> **First deploy to a new store?** The uploaded files aren't live until you paste
> the two tags into that store's admin **HTML code** tab (see
> [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). Until then they just sit in
> `/code_files/`, invisible to visitors — so a manual deploy is safe to run anytime.

## How auto-discovery works

You **never** maintain import lists or edit config. Just create files and folders:

- **Add an SCSS partial** — drop `_whatever.scss` into any folder under `src/scss/`.
- **Add a JS module** — drop `whatever.js` into any folder under `src/js/`.
- **Add a whole new page folder** — e.g. `src/scss/checkout/_index.scss` and
  `src/js/checkout/index.js`. No config edits, ever.

`scripts/generate-entries.mjs` globs the trees and writes the entry files
(`src/scss/main.scss`, `src/js/main.js`) with an `AUTO-GENERATED — DO NOT EDIT`
header. Both entries are **gitignored** so the two of us never get merge conflicts
on machine-regenerated import lists.

**Ordering** is convention-based — no folder list to maintain:

1. Foundation folders first, in this order if present: **`base` → `layout` → `components`**.
2. Then every other folder, alphabetically.
3. Within any folder, files alphabetically.

Folder names: single word or `snake_case`, **no spaces**, must **not start with a number**.

## How `npm run dev` works

```
npm run dev
  ├─ generate            (write the entry files once)
  └─ run in parallel:
       ├─ watch:entries      regenerate entries ONLY when files/folders are added/removed
       ├─ dev:css:compile    sass --watch  → dist/main.css (+ sourcemap)
       ├─ dev:css:process    postcss --watch → dist/main.min.css (+ chained map)
       └─ dev:js             esbuild --watch → dist/main.min.js (un-minified for dev)
```

Save a partial/module → sass/esbuild recompile → **Live Server reloads** the page.
Entries are regenerated **only** on add/remove (when the import list actually
changes), never on plain content edits — those are handled by the sass/esbuild
watchers. See [docs/LOCAL_PREVIEW.md](docs/LOCAL_PREVIEW.md).

> The dev JS file is named `main.min.js` for a stable path, but `dev:js` omits
> `--minify` so dev output is readable. Production `build:js` does minify.

## Autoprefixing

Write plain CSS — **never write `-webkit-`/`-moz-`/`-ms-` by hand.** Autoprefixer
adds vendor prefixes automatically, driven by [.browserslistrc](.browserslistrc).
Editing `.browserslistrc` changes which prefixes are emitted; no other change is
needed. Run `npx browserslist` to see which browsers your queries resolve to.

## Shared SCSS variables

The generator controls **inclusion and emission order only** — it does _not_ wire
cross-file variable access. Any partial that needs a shared variable/mixin must
`@use 'base/variables' as vars;` itself and reference `vars.$x`. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#shared-variables).

## Deploy flow

```
git push origin main
      │
      ▼
GitHub Actions (.github/workflows/deploy.yml)
      │  npm ci
      │  npm run build      (regenerates entries, bundles CSS + JS)
      ▼
scripts/deploy.mjs   (builds once, then for EACH store in STORES_JSON:)
      └─ SFTP upload → /code_files/{main.min.css,.map, main.min.js,.map}
   (a failing store is recorded and skipped; the run continues, then exits
    non-zero at the end if any store failed)
   Finally: prints the <link>/<script> tags to paste in the admin (one-time).
```

The deploy is **SFTP-only — no Shoptet API.** The files are overwritten in place
each push (URLs never change). You paste the `<link>`/`<script>` once in each
store's admin "HTML code" tab and **bump the `?v=N` by hand** when you want
browsers to refetch. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Multiple stores

You deploy one build to **many Shoptet stores**, each with its own SFTP creds. All
of them live in a **single** secret, `STORES_JSON` — a JSON array of store objects:

```json
[
	{ "name": "natima-cz", "ftpHost": "ftp.myshoptet.com", "ftpUser": "u1", "ftpPass": "p1" },
	{ "name": "natima-sk", "ftpHost": "ftp.myshoptet.com", "ftpUser": "u2", "ftpPass": "p2" }
]
```

Required per store: `ftpHost`, `ftpUser`, `ftpPass`. Optional: `name`, `ftpPort`
(22), `ftpKeyPath` (for SSH key auth). No API fields. **Add a store later by
appending one object** (then paste the two tags into that store's admin — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Required GitHub secret

Set this in **Settings → Secrets and variables → Actions**:

| Secret        | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `STORES_JSON` | JSON array of store objects (shape above). One secret holds every store. |

> **Back-compat:** if `STORES_JSON` is unset, the script falls back to the legacy
> single-store vars (`FTP_HOST`, `FTP_PORT`, `FTP_USER`, `FTP_PASS`).

## How deploy reaches the store

- **Upload — SFTP** (SSH, port 22), via `ssh2-sftp-client`, pushing bytes directly
  to `/code_files/`. Key auth? Add `ftpKeyPath` to that store in `STORES_JSON`
  (see the note in `uploadFiles()`). **No Shoptet API is used.**
- **Tags — pasted once in the admin.** In each store's "HTML code" tab, put the CSS
  `<link>` in **common-header** and the JS `<script>` in **common-footer**. The
  deploy prints the exact tags at the end of every run so you can copy them.
- **Cache-bust — manual `?v=N`.** Filenames are stable; the deploy overwrites them
  in place. Bump `?v=1` → `?v=2` in the admin tag when you want browsers to refetch.

> **Why no API?** Deliberate: keeping the tags in the GUI means an API outage or
> token problem can never lock you out of changing styles/scripts on the live site.
> See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
