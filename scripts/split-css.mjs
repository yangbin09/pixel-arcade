// 一次性脚本：把旧的 assets/style.css 按既有分节切成多模块样式
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(resolve(root, "assets/style.css"), "utf8").split(/\r?\n/);
const line = (n) => src[n - 1] ?? "";

mkdirSync(resolve(root, "packages/styles/src"), { recursive: true });

const head = (title) => `/* ============================================================
   PIXEL ARCADE · ${title}
   由旧 assets/style.css 按原有分节拆出，样式值未改动。
   ============================================================ */

`;

const parts = [
  ["tokens.css", "TOKENS · 调色板 / 语义色 / 字体 / 间距", 7, 52],
  ["base.css", "BASE · 重置 / 背景 / 外壳 / 通用控件", 54, 235],
  ["home.css", "HOME · 首页 / 卡片 / 机位", 236, 887],
  ["play.css", "PLAY · 游戏页外壳 / HUD / 画面 / 弹窗", 889, 1629],
  ["motion.css", "MOTION · 关键帧 / 减少动效", 1630, src.length],
];

for (const [file, title, from, to] of parts) {
  const body = src.slice(from - 1, to).join("\n").replace(/\s+$/, "");
  writeFileSync(resolve(root, "packages/styles/src", file), head(title) + body + "\n", "utf8");
  console.log(file, "lines", from, "-", to);
}
