import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // file:-linked sibling packages carry their own react copy — force one instance.
    dedupe: ["react", "react-dom"],
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // Core tests run in node; the react test file opts into jsdom via the
    // `// @vitest-environment jsdom` pragma at its top.
    environment: "node",
  },
});
