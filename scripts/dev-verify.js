// Runs `next dev` against an isolated `.next-verify` build directory (see
// next.config.mjs's LB_DIST_DIR) so this doesn't step on another already-
// running `next dev`'s `.next` directory.
process.env.LB_DIST_DIR = '.next-verify';

const { spawn } = require('child_process');
const port = process.env.PORT || '3001';
const child = spawn('npx', ['next', 'dev', '-H', '0.0.0.0', '-p', port], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});
child.on('exit', (code) => process.exit(code ?? 0));
