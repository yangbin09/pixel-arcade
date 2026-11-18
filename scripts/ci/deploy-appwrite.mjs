/**
 * GitHub Actions → Appwrite Sites 静态部署。
 *
 * 环境变量：
 *   APPWRITE_ENDPOINT   默认 https://cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID
 *   APPWRITE_SITE_ID
 *   APPWRITE_API_KEY    API Key（sites.read + sites.write）
 *   APPWRITE_SITE_URL   可选，部署完成后做一次 HTTP 自检
 *   DIST_DIR            默认 dist
 *   PACKAGE_PATH        默认 .artifacts/appwrite/site.tar.gz
 *
 * 流程：打包 dist（排除 nginx 用的 .gz）→ 创建部署并激活 → 轮询到 ready → 线上自检。
 * 只做「新增部署」，不修改站点结构/域名规则，失败时旧部署继续在线。
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ENDPOINT = (process.env.APPWRITE_ENDPOINT ?? "https://cloud.appwrite.io/v1").replace(/\/+$/, "");
const PROJECT = process.env.APPWRITE_PROJECT_ID;
const SITE = process.env.APPWRITE_SITE_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
const SITE_URL = (process.env.APPWRITE_SITE_URL ?? "").replace(/\/+$/, "");
const DIST_DIR = resolve(process.env.DIST_DIR ?? "dist");
const PACKAGE_PATH = resolve(process.env.PACKAGE_PATH ?? ".artifacts/appwrite/site.tar.gz");
const RESPONSE_FORMAT = "1.8.0";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 15 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`缺少环境变量 ${name}`);
    process.exit(1);
  }
  return value;
}

const projectId = requireEnv("APPWRITE_PROJECT_ID");
const siteId = requireEnv("APPWRITE_SITE_ID");
const apiKey = requireEnv("APPWRITE_API_KEY");

function headers(extra = {}) {
  return {
    "X-Appwrite-Project": projectId,
    "X-Appwrite-Key": apiKey,
    "X-Appwrite-Response-Format": RESPONSE_FORMAT,
    ...extra,
  };
}

async function api(path, init = {}) {
  const res = await fetch(`${ENDPOINT}${path}`, { ...init, headers: headers(init.headers ?? {}) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

function requirementError(body) {
  return `HTTP 错误：${typeof body === "string" ? body : JSON.stringify(body)}`;
}

function writeSummary(lines) {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  }
}

function packageSite() {
  const distStat = statSync(DIST_DIR, { throwIfNoEntry: false });
  if (!distStat?.isDirectory()) throw new Error(`找不到构建产物：${DIST_DIR}`);
  mkdirSync(dirname(PACKAGE_PATH), { recursive: true });
  execFileSync(
    "tar",
    ["-czf", PACKAGE_PATH, "-C", DIST_DIR, "--exclude", "*.gz", "--exclude", "*.br", "."],
    { stdio: "inherit" },
  );
  const size = statSync(PACKAGE_PATH).size;
  console.log(`打包完成：${PACKAGE_PATH}（${(size / 1024).toFixed(1)} KB）`);
  return size;
}

async function listDeployments() {
  const res = await api(`/sites/${siteId}/deployments`);
  if (!res.ok) return [];
  return res.body?.deployments ?? [];
}

async function createDeployment(packageSize) {
  const bytes = readFileSync(PACKAGE_PATH);
  const form = new FormData();
  form.set("code", new Blob([bytes], { type: "application/gzip" }), "site.tar.gz");
  form.set("activate", "true");

  const res = await fetch(`${ENDPOINT}/sites/${siteId}/deployments`, {
    method: "POST",
    headers: headers(),
    body: form,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`创建部署失败（HTTP ${res.status}）：${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  console.log(
    `已创建部署：${body.$id}（${(packageSize / 1024).toFixed(0)} KB，status=${body.status ?? "created"}）`,
  );
  return body;
}

async function waitDeployment(deploymentId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = "";
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await api(`/sites/${siteId}/deployments/${deploymentId}`);
    if (!res.ok) {
      if (res.status === 404) continue;
      throw new Error(requirementError(res.body));
    }
    const deployment = res.body;
    const status = deployment.status ?? "unknown";
    if (status !== lastStatus) {
      console.log(`部署状态：${status}`);
      lastStatus = status;
    }
    if (status === "ready") return deployment;
    if (["failed", "canceled", "cancelled"].includes(status)) {
      if (deployment.buildLogs) {
        console.error("构建日志：\n" + String(deployment.buildLogs).slice(-8000));
      }
      throw new Error(`部署失败：status=${status}`);
    }
  }
  throw new Error(`部署超时（${POLL_TIMEOUT_MS / 1000}s），最后状态：${lastStatus}`);
}

async function verifySite() {
  if (!SITE_URL) {
    console.log("未设置 APPWRITE_SITE_URL，跳过 HTTP 自检");
    return true;
  }
  const deadline = Date.now() + 120_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SITE_URL}/`, { redirect: "follow" });
      const text = await res.text();
      if (res.ok && text.includes("PIXEL ARCADE")) {
        console.log(`线上自检通过：${SITE_URL}（HTTP ${res.status}，${text.length} 字节）`);
        return true;
      }
      lastError = `HTTP ${res.status}，len=${text.length}`;
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
    await sleep(3_000);
  }
  throw new Error(`线上自检失败：${lastError}`);
}

let exitCode = 0;
try {
  console.log(`部署目标：${ENDPOINT} / project=${projectId} / site=${siteId}`);
  const previous = await listDeployments();
  if (previous.length) {
    console.log(`已有部署：${previous.slice(0, 3).map((item) => `${item.$id}:${item.status}`).join(", ")}`);
  }

  const packageSize = packageSite();
  const deployment = await createDeployment(packageSize);
  await waitDeployment(deployment.$id);
  await verifySite();

  writeSummary([
    "## Appwrite Sites 部署",
    "",
    `- 站点：\`${siteId}\``,
    `- 部署：\`${deployment.$id}\``,
    `- 包大小：${(packageSize / 1024).toFixed(1)} KB`,
    `- 地址：${SITE_URL || `https://${siteId}.appwrite.network`}`,
    "",
  ]);
} catch (error) {
  console.error(`Appwrite 部署失败：${error?.message ?? error}`);
  if (String(error?.message ?? "").match(/401|403/)) {
    console.error("提示：检查 API Key 是否包含 sites.read + sites.write，以及是否属于本项目。");
  }
  exitCode = 1;
}

process.exit(exitCode);
