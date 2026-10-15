import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Served from https://<user>.github.io/<repo>/ on GitHub Pages. Override with
// BASE_PATH (e.g. "/" for a custom domain or a <user>.github.io repo).
const base = process.env.BASE_PATH ?? "/wiki-quiz/";

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
