import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Runs the tests inside a local copy of the Workers runtime, using the same
// settings file as the real Worker.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // A stand-in for the real secret, so the code has something to read.
      // It is not a key and opens nothing. Tests never reach a real provider.
      miniflare: { bindings: { MODEL_API_KEY: "placeholder-not-a-real-key" } },
    }),
  ],
});
