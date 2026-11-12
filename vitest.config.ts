import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Runs the tests inside a local copy of the Workers runtime, using the same
// settings file as the real Worker.
export default defineConfig({
  // The first test in each file waits for the local runtime to start.
  test: { testTimeout: 20_000 },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Stand-ins for the real secrets, so the code has something to read.
      // They are not keys and open nothing. Tests never reach a real provider.
      miniflare: {
        bindings: {
          MODEL_API_KEY: "placeholder-not-a-real-key",
          TURNSTILE_SECRET_KEY: "placeholder-not-a-real-secret",
        },
      },
    }),
  ],
});
