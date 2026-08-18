import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A stray lockfile further up the tree otherwise gets picked as the root.
  outputFileTracingRoot: projectRoot,
  // Lets a second, isolated dev/build process (e.g. a verification run
  // alongside another already-running `next dev`) avoid corrupting the
  // shared `.next` directory both would otherwise write to concurrently.
  // Unset for every normal invocation, so this changes nothing by default.
  ...(process.env.LB_DIST_DIR ? { distDir: process.env.LB_DIST_DIR } : {}),
  // Native / built-in sqlite must not be bundled by the server compiler.
  // xlsx (SheetJS) does its own fs access inside readFile() that breaks when
  // webpack bundles it — throws "Cannot access file" even though the file is
  // right there on disk, since it's really the bundler's fs shim tripping up
  // SheetJS's internal file-reading path, not an actual filesystem problem.
  serverExternalPackages: ['better-sqlite3', 'node:sqlite', 'xlsx'],

  // Avatars render through a plain <img> so the headshot → flag/logo → initials
  // fallback chain can hang off onError. These hosts are declared anyway so a
  // later switch to next/image needs no config change.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'a.espncdn.com' },
      { protocol: 'https', hostname: 'img.mlbstatic.com' },
      { protocol: 'https', hostname: 'www.mlbstatic.com' },
    ],
  },
};

export default nextConfig;
