/**
 * 把 dist-standalone/standalone/index.html 挪到 dist-standalone/index.html，
 * 让离线版真正做到「双击一个文件」。
 */
import { existsSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "dist-standalone");
const nested = resolve(root, "standalone");

if (existsSync(nested)) {
  renameSync(resolve(nested, "index.html"), resolve(root, "index.html"));
  rmSync(nested, { recursive: true, force: true });
  console.log("standalone: dist-standalone/index.html 就绪（双击即玩）");
} else if (existsSync(resolve(root, "index.html"))) {
  console.log("standalone: dist-standalone/index.html 已存在");
} else {
  console.error("standalone: 找不到构建产物，请先运行 vite build --config vite.standalone.config.ts");
  process.exitCode = 1;
}
