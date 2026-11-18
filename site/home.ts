import "@styles/home-entry.css";

import { ready, type GameMeta } from "@arcade/core";
import { validateMeta } from "@arcade/registry";
import { mountHome } from "./home-view";

/** 构建期收集所有游戏的 meta（轻量，不含玩法逻辑）。 */
const metaModules = import.meta.glob<{ meta: GameMeta }>("../games/*/src/meta.ts", { eager: true });
/** 预取用：不 eager，悬停/聚焦时才真正 import。 */
const gameLoaders = import.meta.glob("../games/*/src/index.ts");

const metas = Object.values(metaModules)
  .map((mod) => mod.meta)
  .filter((meta): meta is GameMeta => !!meta && typeof meta.id === "string");

if (import.meta.env.DEV) {
  for (const meta of metas) {
    for (const problem of validateMeta(meta)) console.warn("[registry]", problem);
  }
}

ready(() => {
  mountHome({
    metas,
    hrefFor: (id) => `./play/?game=${id}`,
    prefetch: (id) => {
      gameLoaders[`../games/${id}/src/index.ts`]?.().catch(() => {
        /* 预取失败不影响点击；真正进游戏时会再试一次 */
      });
    },
  });
});
