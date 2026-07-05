import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "react/index": "src/react/index.tsx",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Keep peer deps and the heavy proving backends external.
  external: ["viem", "wagmi", "@tanstack/react-query", "react"],
  loader: {
    ".json": "json",
  },
});
