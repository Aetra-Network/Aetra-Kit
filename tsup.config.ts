import { defineConfig } from "tsup";

/**
 * Two bundles: the core client layer (`.`) and the React hooks (`./react`).
 * Splitting them keeps React fully out of server/bot bundles — a Node consumer
 * of `@aetra/kit` never touches react or @aetra/connect-react.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@aetra/sdk",
    "@aetra/connect",
    "@aetra/connect-react",
  ],
});
