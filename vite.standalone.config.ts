import { defineConfig } from "vite";
import { resolve } from "node:path";
import { viteSingleFile } from "vite-plugin-singlefile";

const r = (p: string) => resolve(import.meta.dirname, p);

/**
 * 离线单文件版：把 JS/CSS 全部内联进一个 index.html，
 * 输出到 dist-standalone/，双击即可运行（file:// 也不需要服务器）。
 */
export default defineConfig({
  base: "./",
  appType: "mpa",
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  resolve: {
    alias: {
      "@arcade/core": r("packages/core/src/index.ts"),
      "@arcade/ui": r("packages/ui/src/index.ts"),
      "@arcade/registry": r("packages/registry/src/index.ts"),
      "@styles": r("packages/styles/src"),
    },
  },
  build: {
    outDir: "dist-standalone",
    target: "es2020",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    reportCompressedSize: false,
    rollupOptions: {
      input: r("standalone/index.html"),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
