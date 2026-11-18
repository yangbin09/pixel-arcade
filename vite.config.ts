import { defineConfig } from "vite";
import { resolve } from "node:path";

const r = (p: string) => resolve(import.meta.dirname, p);

/**
 * 多模块构建：
 * - 首页（index.html）与播放壳（play/index.html）是两个入口
 * - 每个游戏是独立模块，通过动态 import 拆成独立 chunk
 * - 所有源码走 TypeScript，视觉层走 packages/styles
 */
export default defineConfig({
  base: "/",
  appType: "mpa",
  resolve: {
    alias: {
      "@arcade/core": r("packages/core/src/index.ts"),
      "@arcade/ui": r("packages/ui/src/index.ts"),
      "@arcade/registry": r("packages/registry/src/index.ts"),
      "@styles": r("packages/styles/src"),
    },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    target: "es2020",
    cssTarget: "chrome100",
    assetsInlineLimit: 2048,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: {
        home: r("index.html"),
        play: r("play/index.html"),
      },
      output: {
        entryFileNames: "assets/js/[name]-[hash].js",
        chunkFileNames(info) {
          const id = info.facadeModuleId ?? "";
          const match = id.match(/games[\\/]([^\\/]+)[\\/]src[\\/](index|meta)\.ts$/);
          if (match) return `assets/js/game-${match[1]}-${match[2]}-[hash].js`;
          return "assets/js/[name]-[hash].js";
        },
        assetFileNames: (info) => {
          const name = info.names?.[0] ?? info.name ?? "asset";
          if (name.endsWith(".css")) return "assets/css/[name]-[hash][extname]";
          return "assets/media/[name]-[hash][extname]";
        },
        manualChunks(id) {
          if (id.includes("/packages/core/")) return "core";
          return undefined;
        },
      },
    },
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
