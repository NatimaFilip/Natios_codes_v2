# Deployment

Deploys are automatic on push to `main`. This document covers the one-time setup,
the automatic flow, and an optional `staging` branch.

> **Design choice — no API.** The deploy uploads files over SFTP and nothing else.
> The `<link>`/`<script>` tags are pasted by hand into each store's admin, and you
> control cache-busting with a manual `?v=N`. This is deliberate: if anything ever
> breaks, you edit the tags directly in the GUI — there is no API dependency that
> could lock you out of changing styles or scripts.

## One-time setup

### 1. Paste the two tags in each store's admin (once)

In **each** store: admin → **HTML code** tab (`/admin/html-kody/`). Paste the CSS
link into **common-header** (`<head>`) and the JS script into **common-footer**
(before `</body>`):

```html
<!-- common-header -->
<link rel="stylesheet" href="/code_files/main.min.css?v=1" />

<!-- common-footer -->
<script src="/code_files/main.min.js?v=1" defer></script>
```

The deploy **prints these exact tags** at the end of each run, so you can just
copy them from the log. The HTML-code field has an **8192-char limit** — these tiny
tags are nowhere near it.

> **Cache-busting is manual.** The filename never changes (`main.min.css` /
> `main.min.js`); each deploy overwrites it via SFTP. When you want browsers to
> refetch, bump the version in the tag by hand: `?v=1` → `?v=2` → `?v=3`. The
> deploy logs the file's content hash for reference, but the `?v=` number is
> entirely yours to set.

### 2. Add the GitHub secret (multi-store)

You deploy to **multiple Shoptet stores** from one build. All store credentials
live in a **single** secret, `STORES_JSON` — a JSON array of store objects. The
deploy builds once and fans out to every store in the array.

**Settings → Secrets and variables → Actions → New repository secret:**

| Secret        | Value                                                             |
| ------------- | ----------------------------------------------------------------- |
| `STORES_JSON` | A JSON array of stores (see shape below). One secret, all stores. |

Per-store fields:

| Field        | Required | Notes                                                       |
| ------------ | -------- | ----------------------------------------------------------- |
| `name`       | no       | Label shown in logs. Defaults to `store-1`, `store-2`, …    |
| `ftpHost`    | **yes**  | SFTP host — **bare hostname**, no `sftp://` prefix.         |
| `ftpPort`    | no       | Defaults to `22`.                                           |
| `ftpUser`    | **yes**  | SFTP username.                                              |
| `ftpPass`    | **yes**  | SFTP password.                                              |
| `ftpKeyPath` | no       | Path to a private key file if that store uses SSH key auth. |

There are **no API fields** — the deploy is SFTP-only.

Example value (two stores — paste as the secret's value, on one line):

```json
[
	{ "name": "natima-cz", "ftpHost": "ftp.myshoptet.com", "ftpUser": "u1", "ftpPass": "p1" },
	{ "name": "natima-sk", "ftpHost": "ftp.myshoptet.com", "ftpUser": "u2", "ftpPass": "p2" }
]
```

> **Adding a store later** = add one object to the array and re-save the secret,
> then paste the two tags into that store's admin (step 1). No code change.

For **local** deploys/testing, copy `.env.example` → `.env`. In a `.env` file
`STORES_JSON` must be **one line**, wrapped in single quotes so the inner
double-quotes survive (the example file shows this). `.env` is gitignored.

> **Back-compat:** if `STORES_JSON` is unset, the script falls back to the legacy
> single-store `FTP_HOST` / `FTP_PORT` / `FTP_USER` / `FTP_PASS` vars. Prefer
> `STORES_JSON` — you have multiple stores.

### 3. SFTP key auth (optional)

Uploads use `ssh2-sftp-client` over SSH (port 22) with a password by default. If a
store needs **key** auth instead, add an `ftpKeyPath` to that store in
`STORES_JSON` and use the `privateKey` line shown in the comment inside
`uploadFiles()`.

## Automatic flow

```
git push origin main
      │
      ▼  .github/workflows/deploy.yml
  actions/checkout@v4
  actions/setup-node@v4   (node 20, npm cache)
  npm ci
  npm run build           (regenerates entries → bundles CSS + JS in CI)
  node scripts/deploy.mjs
      ├─ content-hash main.min.css and main.min.js (logged for reference) — ONCE
      ├─ for EACH store in STORES_JSON:
      │     └─ SFTP upload → /code_files/{main.min.css,.map, main.min.js,.map}
      │        (a failing store is recorded and skipped; the run continues)
      └─ print the exact <link>/<script> tags to paste in the admin (one-time)
```

The deploy **overwrites the files in place** every push — the URLs never change.
Browsers refetch only when **you** bump the `?v=N` in the admin tag (manual cache-
bust). The build regenerates the (gitignored) entry files in CI, so you never
commit them. `deploy.mjs` attempts **every** store, prints an `N/total uploaded`
summary, and exits non-zero if **any** store failed (with clear per-store
logging), so a broken upload fails the Actions run loudly.

## Optional: a `staging` branch

To test on the live store **without touching production**, add a `staging` branch
that deploys to a parallel set of files (`main.staging.min.css` /
`main.staging.min.js`).

Sketch:

1. Duplicate `.github/workflows/deploy.yml` as `deploy-staging.yml`, trigger on
   `push` to `staging`.
2. In a copy of `deploy.mjs` (or via an env flag), set
   `REMOTE_BASENAME = 'main.staging.min'` so it uploads to different filenames.
3. Paste a separate `<link>`/`<script>` for `main.staging.min.*` into the admin —
   e.g. behind a query flag or only on a test page — so the staging files load
   without touching the production tags.

This keeps production bytes untouched while you validate a build on the real store.
