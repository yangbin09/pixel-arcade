/**
 * 游戏清单自检：每个机位都要有目录、包、meta 与入口，
 * 并且 meta 里的 id / no 必须和 slots.json 对得上。
 * 如果 dist 存在，再检查每个游戏是否产出了独立 chunk。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const slots = JSON.parse(readFileSync(resolve(root, "packages/registry/slots.json"), "utf8"));

const problems = [];
const seen = new Set();

for (const slot of slots) {
  const dir = resolve(root, "games", slot.id);
  const files = {
    "package.json": resolve(dir, "package.json"),
    "src/meta.ts": resolve(dir, "src/meta.ts"),
    "src/index.ts": resolve(dir, "src/index.ts"),
  };
  for (const [name, path] of Object.entries(files)) {
    if (!existsSync(path)) problems.push(`${slot.id}: 缺少 ${name}`);
  }
  if (existsSync(files["src/meta.ts"])) {
    const source = readFileSync(files["src/meta.ts"], "utf8");
    if (!new RegExp(`id:\\s*["']${slot.id}["']`).test(source)) {
      problems.push(`${slot.id}: meta.ts 里的 id 不是 "${slot.id}"`);
    }
    if (!new RegExp(`no:\\s*${slot.no}\\b`).test(source)) {
      problems.push(`${slot.id}: meta.ts 里的 no 不是 ${slot.no}`);
    }
  }
  if (existsSync(files["src/index.ts"])) {
    const source = readFileSync(files["src/index.ts"], "utf8");
    if (!/export\s+default/.test(source)) {
      problems.push(`${slot.id}: index.ts 没有 export default`);
    }
  }
  if (seen.has(slot.no)) problems.push(`机位号 ${slot.no} 重复`);
  seen.add(slot.no);
}

const jsDir = resolve(root, "dist/assets/js");
if (existsSync(jsDir)) {
  const chunks = readdirSync(jsDir);
  for (const slot of slots) {
    if (!chunks.some((name) => name.startsWith(`game-${slot.id}-index-`))) {
      problems.push(`${slot.id}: dist 里没有 game-${slot.id}-index 独立 chunk`);
    }
  }
}

if (problems.length) {
  console.error("游戏清单有问题：");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

console.log(`check:games 通过，共 ${slots.length} 个机位：${slots.map((s) => s.id).join(", ")}`);
