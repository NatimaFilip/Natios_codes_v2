/**
 * PostCSS configuration.
 *
 * This file is .cjs (CommonJS) ON PURPOSE: package.json sets "type":"module",
 * which makes plain .js files ESM. postcss-cli loads its config with require(),
 * so the config must stay CommonJS — hence the .cjs extension.
 *
 * Plugin order matters:
 *   1. autoprefixer — adds vendor prefixes based on .browserslistrc.
 *   2. cssnano      — minifies (default preset) as the LAST step.
 */
module.exports = {
  plugins: [
    require('autoprefixer'),
    require('cssnano')({ preset: 'default' }),
  ],
};
