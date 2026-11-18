/**
 * 产物体积预算：对 dist 做 gzip 统计，超出 bundle-budget.json 里的阈值就失败。
 * 阈值是「硬上限」，正常改动不应该顶到上限；用它拦住误引入大依赖或重复打包。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "../..");
const DIST = resolve(ROOT, process.env.DIST_DIR ?? "dist");
const STANDALONE = resolve(ROOT, process.env.STANDALONE_DIR ?? "dist-standalone");
const CONFIG = resolve(ROOT, "bundle-budget.json");

const budget = JSON.parse(readFileSync(CONFIG, "utf8"));

function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walk(full));
      continue;
    }
    result.push(full);
  }
  return result;
}

if (!statSync(DIST, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`找不到构建产物：${DIST}，请先运行 npm run build:all`);
  process.exit(1);
}

const files = walk(DIST);
const sources = files.filter((file) => !/\.(gz|br)$/.test(file));
const jsFiles = sources.filter((file) => file.endsWith(".js"));
const cssFiles = sources.filter((file) => file.endsWith(".css"));
const gameChunks = jsFiles.filter((file) => /[/\\]game-[^/\\]+-(index|meta)-[^/\\]+\.js$/.test(file));

const raw = (list) => list.reduce((sum, file) => sum + statSync(file).size, 0);
const gzipped = (list) =>
  list.reduce((sum, file) => sum + gzipSync(readFileSync(file), { level: 9 }).length, 0);

const standaloneStat = statSync(resolve(STANDALONE, "index.html"), { throwIfNoEntry: false });

const metrics = [
  {
    name: "JS (gzip)",
    actual: gzipped(jsFiles) / 1024,
    limit: budget.jsGzipKB,
    format: "KB",
  },
  {
    name: "CSS (gzip)",
    actual: gzipped(cssFiles) / 1024,
    limit: budget.cssGzipKB,
    format: "KB",
  },
  {
    name: "全部产物体积",
    actual: raw(sources) / 1024,
    limit: budget.totalRawKB,
    format: "KB",
  },
  {
    name: "单文件离线版",
    actual: standaloneStat ? standaloneStat.size / 1024 : 0,
    limit: budget.standaloneKB,
    format: "KB",
  },
  {
    name: "游戏独立 chunk",
    actual: gameChunks.length,
    limit: budget.gameChunksMin,
    format: "个",
    min: true,
  },
];

const failures = [];
const lines = ["## 产物体积预算", "", "| 指标 | 实际 | 预算 | 结果 |", "| --- | --- | --- | --- |"];
for (const metric of metrics) {
  const pass = metric.min ? metric.actual >= metric.limit : metric.actual <= metric.limit;
  const position = metric.min ? "≥" : "≤";
  lines.push(
    `| ${metric.name} | ${Number(metric.actual.toFixed(1))} ${metric.format} | ${position} ${metric.limit} ${metric.format} | ${pass ? "✅" : "❌"} |`,
  );
  if (!pass) failures.push(`${metric.name}=${metric.actual.toFixed(1)}，预算 ${position} ${metric.limit}`);
}
lines.push("", `产物文件数：${sources.length}（不含 .gz / .br 预压缩文件）`);

console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

if (failures.length) {
  console.error(`\n体积预算超限：\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
