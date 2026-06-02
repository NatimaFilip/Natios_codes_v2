# Local preview

Preview your built CSS/JS against real Shoptet markup, locally, with live reload.

## Tools

- **VS Code** with the **Live Server** extension (serves on `http://127.0.0.1:5500`).
- `npm run dev` running in a terminal.

## Workflow

1. **Download a page's markup** from your live store (browser → *Save page* / *View
   source*, or copy the rendered HTML). You want the page body you're styling.

2. **Paste it into `dev.html`**, between the `<body>` tags, replacing the demo
   markup. `dev.html` already links the local build:

   ```html
   <link rel="stylesheet" href="http://127.0.0.1:5500/dist/main.min.css" />
   ...
   <script src="http://127.0.0.1:5500/dist/main.min.js" defer></script>
   ```

   > `dev.html` is **gitignored** — it holds machine-specific Live Server URLs and
   > whatever page markup you're currently testing, so it never lands in the repo.

3. **Start the dev pipeline:**

   ```bash
   npm run dev
   ```

   This generates the entry files once, then runs four watchers in parallel:
   - `watch:entries` — regenerates entries **only** when you add/remove a file or
     folder.
   - `dev:css:compile` — sass `--watch` → `dist/main.css` (+ map).
   - `dev:css:process` — postcss `--watch` → `dist/main.min.css` (+ chained map).
   - `dev:js` — esbuild `--watch` → `dist/main.min.js` (un-minified for readable
     dev output, same stable path).

4. **Open `dev.html` with Live Server** (right-click → *Open with Live Server*).

5. **Edit and save.** Save a partial/module → sass/esbuild recompile `dist/` →
   Live Server detects the change → the page reloads. Add a whole new folder and
   it's auto-discovered into the entries with no config edits.

## Notes

- The previewed files are `dist/main.min.css` and `dist/main.min.js` — the same
  filenames that get deployed. `dist/main.css` is just an intermediate.
- If styles look unprefixed locally, that's expected: Autoprefixer only adds the
  prefixes your `.browserslistrc` targets actually need. Run `npx browserslist` to
  see those targets.
- If Live Server uses a port other than `5500`, update the two URLs in `dev.html`
  to match.
