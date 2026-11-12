import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Remote tests change data in the real dev Supabase project, so they run only with RUN_REMOTE_TESTS=1 exactly.
const runRemote = process.env.RUN_REMOTE_TESTS === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next resolves "server-only" itself (it fails the build if a client component imports it); tests run on the server side.
      "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Each database test file replays every migration into its own in-memory Postgres in beforeAll, and some
    // tests replay the whole chain again; run in parallel on a busy machine that exceeds the 10s and 5s defaults.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    exclude: runRemote ? configDefaults.exclude : [...configDefaults.exclude, "tests/remote/**"],
  },
});
