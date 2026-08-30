/**
 * Builds docs/design/player-detail-per-sport.html.
 * All extraction and primitive-patching lives in build-lib.mjs, shared with
 * build-team-detail.mjs so the two boards cannot drift apart.
 *
 * Run:  node docs/design/build-per-sport.mjs
 */
import { writeBoard } from './build-lib.mjs';

writeBoard({
  title: 'Eight Sports, One Page',
  bodyFile: '_ps-body.html',
  extraCss: '_ps-extra.css',
  scriptFiles: ['_ps-data1.js', '_ps-data2.js', '_ps-render.js'],
  outFile: 'player-detail-per-sport.html',
});
