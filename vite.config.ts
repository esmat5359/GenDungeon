import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts", "e2e/**/*.test.ts"],
  },
});
