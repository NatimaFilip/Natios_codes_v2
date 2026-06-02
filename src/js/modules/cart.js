// modules/cart.js
import { qsa } from '../modules/utils.js';

/** Wire up "add to cart" buttons. Called automatically on DOMContentLoaded. */
export function init() {
  qsa('[data-add-to-cart]').forEach((btn) => {
    btn.addEventListener('click', () => {
      console.log('[cart] add to cart:', btn.dataset.addToCart);
    });
  });
}
