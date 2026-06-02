// modules/menu.js
import { qs } from '../modules/utils.js';

/** Toggle the mobile navigation menu. Called automatically on DOMContentLoaded. */
export function init() {
  const toggle = qs('[data-menu-toggle]');
  const nav = qs('[data-menu]');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    nav.classList.toggle('is-open');
  });
}
