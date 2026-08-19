import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.ts on purpose: the production build config stays
// untouched (no risk of test-only settings leaking into the shipped
// bundle), while this file adds just what Vitest needs (jsdom environment,
// the same "@" alias, and the RTL/jest-dom setup file).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: false,
  },
});
