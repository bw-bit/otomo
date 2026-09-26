import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node", include: ["tests/**/*.test.ts"],
    // The Next adapter imports next/server without an extension; resolve it through Vite.
    server: { deps: { inline: ["@x402/next"] } },
  },
});
