/**
 * Builds docs/design/team-detail-per-sport.html.
 * Shares build-lib.mjs with build-per-sport.mjs -- one patch list, both boards.
 *
 * Run:  node docs/design/build-team-detail.mjs
 */
import { writeBoard } from './build-lib.mjs';

writeBoard({
  title: 'Team Detail, Every Sport',
  bodyFile: '_td-body.html',
  extraCss: '_ps-extra.css',
  scriptFiles: ['_td-data1.js', '_td-data2.js', '_td-render.js'],
  outFile: 'team-detail-per-sport.html',
});
