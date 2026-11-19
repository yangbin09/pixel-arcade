/**
 * 锁文件一致性检查（CI 前置节点）。
 *
 * npm ci 要求 package-lock.json 与 package.json / workspace 完全同步。
 * 新增或删除 workspace 包（games/*、packages/*）后如果忘记重新生成锁文件，
 * 所有 CI job 都会在 npm ci 处报 EUSAGE，但错误信息埋在每个 job 里，不好定位。
 *
 * 做法：在干净 checkout 上跑一次 `npm install --package-lock-only`（不安装 node_modules），
 * 再比较锁文件。比较时忽略 npm 版本差异带来的纯元数据字段：
 * npm 11 会给可选平台依赖写 `"libc"` 字段，npm 10 不写；只比较结构会让 CI（Node 22 / npm 10）
 * 对本地（npm 11）生成的锁文件误报。这里递归剔除 `libc` 后再做结构与值比较。
 *
 * 结果：锁文件真的过期（缺 workspace / 依赖版本不一致）→ 失败并打印差异路径和修复命令；
 * 仅 npm 版本元数据差异 → 通过（提示已忽略该字段）。
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const LOCK_FILE = "package-lock.json";
// 不同 npm 大版本会写入/省略的纯元数据字段
const IGNORED_KEYS = new Set(["libc"]);

const isWindows = process.platform === "win32";
// Windows 上 npm 是 .cmd，需要经 cmd.exe 调用；不要用 shell:true（Node 会报 DEP0190）。
const npmCommand = isWindows ? "cmd.exe" : "npm";
const npmArgs = (args) => (isWindows ? ["/d", "/s", "/c", "npm.cmd", ...args] : args);

function summary(lines) {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (!IGNORED_KEYS.has(key)) result[key] = normalize(child);
    }
    return result;
  }
  return value;
}

function collectDiff(a, b, path = "", out = []) {
  if (out.length >= 40) return out;
  const typeA = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
  const typeB = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
  if (typeA !== typeB) {
    out.push(`${path || "(root)"}: ${typeA} → ${typeB}`);
    return out;
  }
  if (typeA === "object") {
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const key of keys) collectDiff(a?.[key], b?.[key], path ? `${path}.${key}` : key, out);
    return out;
  }
  if (typeA === "array") {
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      collectDiff(a[index], b[index], `${path}[${index}]`, out);
    }
    return out;
  }
  if (a !== b) {
    const format = (value) => JSON.stringify(value) ?? String(value);
    out.push(`${path}: ${format(a)} → ${format(b)}`);
  }
  return out;
}

const original = readFileSync(LOCK_FILE, "utf8");
let exitCode = 0;

try {
  const install = spawnSync(
    npmCommand,
    npmArgs(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]),
    { encoding: "utf8", timeout: 180_000 },
  );
  const installOutput = `${install.stdout ?? ""}${install.stderr ?? ""}`.trim();
  if (install.status !== 0) {
    console.error("npm install --package-lock-only 执行失败：");
    console.error(installOutput.slice(-4000));
    summary(["## 锁文件一致性", "", "❌ `npm install --package-lock-only` 执行失败，请查看日志。"]);
    exitCode = 1;
  } else {
    const regeneratedRaw = readFileSync(LOCK_FILE, "utf8");
    const originalJson = JSON.parse(original);
    const regeneratedJson = JSON.parse(regeneratedRaw);
    const diffPaths = collectDiff(normalize(originalJson), normalize(regeneratedJson));

    if (diffPaths.length === 0) {
      const metadataOnly = regeneratedRaw !== original;
      summary([
        "## 锁文件一致性",
        "",
        metadataOnly
          ? `✅ package-lock.json 与 package.json / workspace 一致（仅忽略 npm 版本元数据差异：${[...IGNORED_KEYS].join(", ")}）。`
          : `✅ package-lock.json 与 package.json / workspace 一致（node ${process.version}）。`,
      ]);
    } else {
      console.error("❌ package-lock.json 与 package.json / workspace 不同步。");
      console.error("");
      console.error("修复方式：在本地运行 `npm install`，把更新后的 package-lock.json 一起提交。");
      console.error("（新增 workspace 包后尤其容易漏：npm ci 会直接报 Missing: @arcade/game-xxx）");
      console.error("");
      console.error("差异路径：");
      console.error(diffPaths.join("\n"));
      console.error("");
      console.error("完整 diff（前 80 行）：");
      console.error(
        spawnSync("git", ["diff", "--", LOCK_FILE], { encoding: "utf8" })
          .stdout?.split(/\r?\n/)
          .slice(0, 80)
          .join("\n") ?? "",
      );

      summary([
        "## 锁文件一致性",
        "",
        "❌ **package-lock.json 与 package.json / workspace 不同步**",
        "",
        "本地运行 `npm install` 后提交 `package-lock.json` 即可。",
        "",
        "差异路径（前 20 条）：",
        "",
        "```",
        diffPaths.slice(0, 20).join("\n"),
        "```",
      ]);
      exitCode = 1;
    }
  }
} finally {
  // 无论成功失败都还原，避免把 npm 写出的中间结果留在工作区
  if (readFileSync(LOCK_FILE, "utf8") !== original) writeFileSync(LOCK_FILE, original);
}

process.exit(exitCode);
