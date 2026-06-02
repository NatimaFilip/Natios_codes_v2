// modules/utils.js
// Shared helpers. Other modules import what they need directly, e.g.
//   import { qs } from '../modules/utils.js';
// esbuild bundles it all into one file, so cross-module imports are free.

/** querySelector shorthand. */
export const qs = (selector, root = document) => root.querySelector(selector);

/** querySelectorAll shorthand returning a real array. */
export const qsa = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector));

// This module has no init() — it is pure helpers. The generated main.js still
// imports it (so it is bundled), but the runtime only calls init() where present.
