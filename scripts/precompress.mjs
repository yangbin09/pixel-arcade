/**
 * 构建后预压缩：给 nginx 的 gzip_static 准备 .gz（可选 .br）。
 * 只处理文本类资源，不碰已经压缩过的图片。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";

const dist = resolve(process.cwd(), "dist");
const TYPES = new Set([".html", ".js", ".css", ".svg", ".json", ".webmanifest", ".txt"]);
const BROTLI = process.argv.includes("--br");

let files = 0;
let before = 0;
let after = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!TYPES.has(extname(entry))) continue;
    const source = readFileSync(full);
    if (source.length < 512) continue;
    const gz = gzipSync(source, { level: zc.Z_BEST_COMPRESSION });
    writeFileSync(`${full}.gz`, gz);
    files += 1;
    before += source.length;
    after += gz.length;
    if (BROTLI) {
      const br = brotliCompressSync(source, {
        params: { [zc.BROTLI_PARAM_QUALITY]: 11 },
      });
      writeFileSync(`${full}.br`, br);
    }
  }
}

try {
  walk(dist);
  const saved = before ? Math.round((1 - after / before) * 100) : 0;
  console.log(
    `precompress: ${files} 个文件, ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB (-${saved}%)`,
  );
} catch (error) {
  console.error(`precompress 失败，请先运行 vite build：${relative(process.cwd(), dist)}`, error);
  process.exitCode = 1;
}
