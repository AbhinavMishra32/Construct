import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/main/index.ts",
    preload: "src/preload/index.ts"
  },
  format: ["cjs"],
  clean: true,
  dts: false,
  outDir: "dist",
  outExtension() {
    return {
      js: ".cjs"
    };
  }
});

