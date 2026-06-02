#!/usr/bin/env node
/**
 * scripts/deploy.mjs
 * ----------------------------------------------------------------------------
 * Uploads the built CSS/JS (and their sourcemaps) to Shoptet via SFTP. That's it
 * — NO Shoptet API calls. The <link>/<script> tags live in each store's admin GUI
 * ("HTML code" tab), pasted ONCE by hand, with a manual ?v=N you bump when you
 * want browsers to refetch. This keeps you fully in control: if anything breaks,
 * you edit the tags directly in the GUI — no API dependency to lock you out.
 *
 * After uploading, this script PRINTS the exact tags to paste (and the current
 * content hash, for reference) so you can copy them into the GUI on first setup.
 *
 * Transfer protocol: SFTP (SSH, port 22) — confirmed with Shoptet. We push the
 * file BYTES directly, so dist/ does NOT need to be publicly reachable.
 *
 * MULTI-STORE: builds once, then uploads to EVERY configured store. Stores come
 * from a single STORES_JSON env var (a JSON array — see resolveStores / .env.example).
 * If STORES_JSON is absent it falls back to the legacy single-store FTP_* env vars.
 * One store failing does NOT stop the others; the run collects failures and
 * exits non-zero at the end if any store failed.
 *
 * Run locally:  node scripts/deploy.mjs   (reads .env)
 * In CI:        env vars come from GitHub secrets — see .github/workflows/deploy.yml
 * ----------------------------------------------------------------------------
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SftpClient from "ssh2-sftp-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// ---- Load .env locally (no dependency). In CI the vars are already set. ----
async function loadDotEnv() {
	try {
		const raw = await readFile(path.join(ROOT, ".env"), "utf8");
		for (const line of raw.split(/\r?\n/)) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (!m) continue;
			const key = m[1];
			let val = m[2];
			// strip optional surrounding quotes
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			}
			if (process.env[key] === undefined) process.env[key] = val;
		}
	} catch {
		// No .env file (e.g. in CI) — rely on the environment as-is.
	}
}

// ---- Config / remote paths ----
const REMOTE_DIR = "/code_files";
const REMOTE_BASENAME = "main.min"; // main.min.css / main.min.js etc.

/** 10-char sha1 of a file's CONTENT (not git SHA) — printed for reference so you
 *  know whether the bytes actually changed since your last manual ?v= bump. */
async function contentHash(absFile) {
	const buf = await readFile(absFile);
	return createHash("sha1").update(buf).digest("hex").slice(0, 10);
}

/** The exact tags you paste ONCE into each store's admin "HTML code" tab.
 *  You control the ?v=N by hand — bump it when you want browsers to refetch.
 *  CSS goes in the header (<head>), JS in the footer (before </body>). */
function guiTags(version = 1) {
	return {
		header: `<link rel="stylesheet" href="${REMOTE_DIR}/${REMOTE_BASENAME}.css?v=${version}">`,
		footer: `<script src="${REMOTE_DIR}/${REMOTE_BASENAME}.js?v=${version}" defer></script>`,
	};
}

// ---------------------------------------------------------------------------
// SFTP upload (SSH, port 22) — pushes file bytes directly. Per-store.
// ---------------------------------------------------------------------------
async function uploadFiles(store) {
	const client = new SftpClient();

	try {
		await client.connect({
			host: store.ftpHost, // bare hostname, NO protocol prefix (no "sftp://")
			port: store.ftpPort,
			username: store.ftpUser,
			password: store.ftpPass,
			// If a store's SFTP uses key auth instead of a password, give that store an
			// "ftpKeyPath" in STORES_JSON and read it here:
			//   privateKey: await readFile(store.ftpKeyPath)
		});

		// Ensure the remote directory exists (mkdir -p semantics; ignore if present).
		if (!(await client.exists(REMOTE_DIR))) {
			await client.mkdir(REMOTE_DIR, true);
		}

		const files = ["main.min.css", "main.min.css.map", "main.min.js", "main.min.js.map"];
		for (const f of files) {
			const local = path.join(DIST, f);
			const remote = `${REMOTE_DIR}/${f}`;
			console.log(`[${store.name}] [sftp] uploading ${f} -> ${remote}`);
			// put() overwrites an existing remote file, so re-deploys replace in place
			// (stable filename + ?v=HASH cache-bust handles versioning).
			await client.put(local, remote);
		}
		console.log(`[${store.name}] [sftp] upload complete`);
	} finally {
		await client.end();
	}
}

// ---------------------------------------------------------------------------
// Store resolution
// ---------------------------------------------------------------------------

/** Normalize one raw store object, applying defaults and validating required
 *  fields. Returns the cleaned store; throws (with the store's name) if invalid. */
function normalizeStore(raw, idx) {
	const name = raw.name || `store-${idx + 1}`;
	const store = {
		name,
		ftpHost: raw.ftpHost,
		ftpPort: Number(raw.ftpPort) || 22,
		ftpUser: raw.ftpUser,
		ftpPass: raw.ftpPass,
		ftpKeyPath: raw.ftpKeyPath, // optional, only if using key auth
	};
	const requiredFields = ["ftpHost", "ftpUser", "ftpPass"];
	const missing = requiredFields.filter((k) => !store[k]);
	if (missing.length) {
		throw new Error(`store "${name}" is missing: ${missing.join(", ")}`);
	}
	if (/^\w+:\/\//.test(store.ftpHost)) {
		throw new Error(
			`store "${name}" ftpHost must be a bare hostname, not a URL (got "${store.ftpHost}"). ` +
				`Remove the protocol prefix (e.g. "sftp://").`,
		);
	}
	return store;
}

/** Build the list of stores to upload to.
 *  Preferred:  STORES_JSON = JSON array of store objects.
 *  Fallback:   the single-store FTP_* env vars (back-compat). */
function resolveStores() {
	const json = process.env.STORES_JSON;
	if (json && json.trim()) {
		let parsed;
		try {
			parsed = JSON.parse(json);
		} catch (err) {
			throw new Error(`STORES_JSON is not valid JSON: ${err.message}`);
		}
		if (!Array.isArray(parsed) || parsed.length === 0) {
			throw new Error("STORES_JSON must be a non-empty JSON array of store objects.");
		}
		return parsed.map((raw, i) => normalizeStore(raw, i));
	}

	// Back-compat single-store mode from the original env-var names.
	const single = {
		name: "default",
		ftpHost: process.env.FTP_HOST,
		ftpPort: process.env.FTP_PORT,
		ftpUser: process.env.FTP_USER,
		ftpPass: process.env.FTP_PASS,
	};
	if (!single.ftpHost) {
		throw new Error(
			"No stores configured. Set STORES_JSON (a JSON array of stores), or the " +
				"single-store FTP_HOST/FTP_PORT/FTP_USER/FTP_PASS vars.",
		);
	}
	return [normalizeStore(single, 0)];
}

// ---------------------------------------------------------------------------
// main — build once, fan out to every store, continue-on-error, fail at end.
// ---------------------------------------------------------------------------
async function main() {
	await loadDotEnv();

	let stores;
	try {
		stores = resolveStores();
	} catch (err) {
		console.error(`[deploy] config error: ${err.message}`);
		process.exit(1);
	}

	const cssHash = await contentHash(path.join(DIST, "main.min.css"));
	const jsHash = await contentHash(path.join(DIST, "main.min.js"));
	console.log(
		`[deploy] content hashes — css:${cssHash} js:${jsHash}\n` +
			`[deploy] uploading to ${stores.length} store(s): ${stores.map((s) => s.name).join(", ")}`,
	);

	const failures = [];
	for (const store of stores) {
		console.log(`\n[deploy] === ${store.name} ===`);
		try {
			await uploadFiles(store);
			console.log(`[deploy] ${store.name} ✓`);
		} catch (err) {
			// Continue to the next store; record and fail at the end.
			console.error(`[deploy] ${store.name} ✗ ${err.message}`);
			failures.push({ name: store.name, message: err.message });
		}
	}

	const ok = stores.length - failures.length;
	console.log(`\n[deploy] summary: ${ok}/${stores.length} uploaded.`);

	// Manual cache-bust reminder: print the exact tags to paste into each store's
	// admin "HTML code" tab. Paste them ONCE; afterwards just bump the ?v=N by hand.
	const tags = guiTags(1);
	console.log(
		`\n[deploy] Paste these ONCE into each store's admin → HTML code:\n` +
			`  common-header (<head>):         ${tags.header}\n` +
			`  common-footer (before </body>): ${tags.footer}\n` +
			`[deploy] Then bump ?v=1 → ?v=2 … by hand to force a browser refresh.`,
	);

	if (failures.length) {
		for (const f of failures) console.error(`[deploy]   FAILED ${f.name}: ${f.message}`);
		process.exit(1);
	}
	console.log("[deploy] all stores done ✓");
}

main().catch((err) => {
	console.error("[deploy] unexpected error:", err);
	process.exit(1);
});
