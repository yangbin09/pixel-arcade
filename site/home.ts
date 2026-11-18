import "@styles/home-entry.css";

import { ready, type GameMeta } from "@arcade/core";
import { validateMeta } from "@arcade/registry";
import { mountHome } from "./home-view";

/** 构建期收集所有游戏的 meta（轻量，不含玩法逻辑）。 */
const metaModules = import.meta.glob<{ meta: GameMeta }>("../games/*/src/meta.ts", { eager: true });

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
  });
});
