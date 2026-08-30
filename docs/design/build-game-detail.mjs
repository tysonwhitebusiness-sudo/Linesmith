/**
 * Builds docs/design/game-detail-per-sport.html.
 * Shares build-lib.mjs with the player and team boards -- one patch list, three boards.
 *
 * Run:  node docs/design/build-game-detail.mjs
 */
import { writeBoard } from './build-lib.mjs';

writeBoard({
  title: 'Game Detail, All Eight',
  bodyFile: '_gd-body.html',
  extraCss: '_ps-extra.css',
  scriptFiles: ['_gd-data1.js', '_gd-data2.js', '_gd-render.js'],
  outFile: 'game-detail-per-sport.html',
});
