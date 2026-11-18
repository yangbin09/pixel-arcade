/**
 * GitHub Actions → VPS（Docker + 宿主 nginx）部署。
 *
 * 环境变量：
 *   VPS_HOST             服务器地址，例如 96.47.231.250
 *   VPS_USER             默认 root
 *   VPS_PORT             默认 22
 *   VPS_SSH_KEY          私钥内容（推荐）或 VPS_SSH_KEY_PATH 指定文件
 *   VPS_HOST_FINGERPRINT 可选，SSH 主机指纹（SHA256:...），设置后强制校验
 *   VPS_SITE_HOST        站点域名（nginx server_name / 自检用），例如 96-47-231-250.sslip.io
 *   VPS_SITE_URL         可选，部署后本地自检地址，默认 https://<VPS_SITE_HOST>
 *   IMAGE_PATH           默认 .artifacts/docker-image/pixel-arcade-image.tar.gz
 *   NGINX_CONF           默认 deploy/games-site.conf
 *
 * 流程：上传镜像 tar.gz → docker load → 重启容器 → 健康检查（失败自动回滚旧镜像）
 *      → 更新 nginx 反代（备份 + nginx -t，失败自动恢复）→ HTTP/HTTPS 自检。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ssh2 from "ssh2";

const { Client } = ssh2;

const HOST = process.env.VPS_HOST;
const USER = process.env.VPS_USER ?? "root";
const PORT = Number(process.env.VPS_PORT ?? 22);
const FINGERPRINT = (process.env.VPS_HOST_FINGERPRINT ?? "").trim();
const SITE_HOST = process.env.VPS_SITE_HOST;
const SITE_URL = (process.env.VPS_SITE_URL ?? (SITE_HOST ? `https://${SITE_HOST}` : "")).replace(/\/+$/, "");
const IMAGE_PATH = resolve(process.env.IMAGE_PATH ?? ".artifacts/docker-image/pixel-arcade-image.tar.gz");
const NGINX_CONF = resolve(process.env.NGINX_CONF ?? "deploy/games-site.conf");
const REMOTE_IMAGE = "/tmp/pixel-arcade-image.tar.gz";
const REMOTE_CONF = "/tmp/games-site.conf";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  console.error(`VPS 部署失败：${message}`);
  process.exit(1);
}

if (!HOST) fail("缺少 VPS_HOST");
if (!SITE_HOST) fail("缺少 VPS_SITE_HOST");

let privateKey = process.env.VPS_SSH_KEY ?? "";
if (!privateKey && process.env.VPS_SSH_KEY_PATH) {
  privateKey = readFileSync(process.env.VPS_SSH_KEY_PATH, "utf8");
}
if (!privateKey) fail("缺少 VPS_SSH_KEY（或 VPS_SSH_KEY_PATH）");
privateKey = privateKey.replace(/\\n/g, "\n").trim() + "\n";

if (!existsSync(IMAGE_PATH)) fail(`找不到镜像包：${IMAGE_PATH}`);
if (!existsSync(NGINX_CONF)) fail(`找不到 nginx 配置：${NGINX_CONF}`);
const imageSize = statSync(IMAGE_PATH).size;
console.log(`镜像包：${IMAGE_PATH}（${(imageSize / 1024 / 1024).toFixed(1)} MB）`);

function connect() {
  return new Promise((resolvePromise, reject) => {
    const client = new Client();
    const hostVerifier = (key) => {
      const actual = "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
      if (!FINGERPRINT) {
        console.log(`SSH 主机指纹（未配置校验）：${actual}`);
        return true;
      }
      if (actual !== FINGERPRINT) {
        console.error(`SSH 主机指纹不匹配：期望 ${FINGERPRINT}，实际 ${actual}`);
        return false;
      }
      return true;
    };
    client
      .on("ready", () => resolvePromise(client))
      .on("error", reject)
      .connect({
        host: HOST,
        port: PORT,
        username: USER,
        privateKey,
        readyTimeout: 30_000,
        keepaliveInterval: 10_000,
        hostVerifier,
      });
  });
}

function exec(client, command, { stream = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    client.exec(command, (error, channel) => {
      if (error) return reject(error);
      let stdout = "";
      let stderr = "";
      channel.on("data", (data) => {
        const text = data.toString();
        stdout += text;
        if (stream) process.stdout.write(text);
      });
      channel.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        if (stream) process.stderr.write(text);
      });
      channel.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    });
  });
}

function upload(client, localPath, remotePath, label) {
  return new Promise((resolvePromise, reject) => {
    client.sftp((error, sftp) => {
      if (error) return reject(error);
      const started = Date.now();
      console.log(`上传 ${label} → ${remotePath}`);
      sftp.fastPut(localPath, remotePath, (err) => {
        sftp.end();
        if (err) return reject(err);
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`上传完成（${seconds}s）`);
        resolvePromise();
      });
    });
  });
}

function remoteScript() {
  return `
set -euo pipefail
STAMP=$(date +%Y%m%d%H%M%S)
CONTAINER=pixel-arcade
IMAGE=pixel-arcade:latest
NEW_IMAGE=pixel-arcade:ci
SITE_HOST=${JSON.stringify(SITE_HOST)}

run_container() {
  docker run -d --name "$CONTAINER" --restart unless-stopped \\
    -p 127.0.0.1:8080:80 \\
    --read-only \\
    --tmpfs /var/cache/nginx \\
    --tmpfs /var/run \\
    --security-opt no-new-privileges:true \\
    "$1"
}

wait_health() {
  for i in $(seq 1 30); do
    if curl -fsS --max-time 2 http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "== 预检 =="
command -v docker >/dev/null || { echo "没有 docker"; exit 10; }
command -v nginx >/dev/null || { echo "没有 nginx"; exit 11; }

echo "== 保留上一个镜像用于回滚 =="
docker tag "$IMAGE" pixel-arcade:rollback 2>/dev/null || true

echo "== 加载新镜像 =="
docker load -i ${REMOTE_IMAGE}
docker tag "$NEW_IMAGE" "$IMAGE"

echo "== 重启容器 =="
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
if ! run_container "$IMAGE"; then
  echo "容器启动失败"
  exit 20
fi
if ! wait_health; then
  echo "健康检查失败，回滚到上一个镜像"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if docker image inspect pixel-arcade:rollback >/dev/null 2>&1; then
    run_container pixel-arcade:rollback || true
    wait_health || true
  fi
  echo "ROLLED_BACK"
  exit 30
fi
docker ps --filter name="$CONTAINER" --format '{{.Names}} | {{.Status}} | {{.Ports}}'

echo "== 更新 nginx 反代（备份 + nginx -t 回滚） =="
if [ -f /etc/nginx/sites-available/games.conf ]; then
  cp -a /etc/nginx/sites-available/games.conf /root/games.conf.bak.$STAMP
fi
install -m 644 ${REMOTE_CONF} /etc/nginx/sites-available/games.conf
if nginx -t; then
  systemctl reload nginx
else
  echo "nginx -t 失败，恢复原配置"
  if [ -f /root/games.conf.bak.$STAMP ]; then
    cp -a /root/games.conf.bak.$STAMP /etc/nginx/sites-available/games.conf
  fi
  nginx -t && systemctl reload nginx
  echo "NGINX_RESTORED"
  exit 40
fi

echo "== 通过 nginx 自检 =="
curl -fsS --max-time 5 -o /dev/null -w 'HTTP %{http_code}\\n' -H "Host: $SITE_HOST" http://127.0.0.1/healthz
if [ -f "/etc/letsencrypt/live/$SITE_HOST/fullchain.pem" ]; then
  curl -kfsS --max-time 10 -H "Host: $SITE_HOST" https://127.0.0.1/healthz
  curl -kfsS --max-time 10 -o /dev/null -w 'HTTPS %{http_code}\\n' -H "Host: $SITE_HOST" https://127.0.0.1/
fi

docker image prune -f >/dev/null 2>&1 || true
echo "DEPLOY_OK stamp=$STAMP"
`;
}

async function fetchChecked(url, check, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      const text = await res.text();
      if (res.ok && check(text)) return true;
      lastError = `HTTP ${res.status}, len=${text.length}`;
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
    await sleep(2_000);
  }
  throw new Error(`${url} 自检失败：${lastError}`);
}

let client;
let exitCode = 0;
try {
  console.log(`连接 ${USER}@${HOST}:${PORT} ...`);
  client = await connect();
  console.log("SSH 已连接");

  await upload(client, IMAGE_PATH, REMOTE_IMAGE, "镜像包");
  await upload(client, NGINX_CONF, REMOTE_CONF, "nginx 配置");

  console.log("远程部署中 ...");
  const result = await exec(client, remoteScript(), { stream: true });
  if (result.code !== 0) {
    const rolledBack = result.stdout.includes("ROLLED_BACK");
    const nginxRestored = result.stdout.includes("NGINX_RESTORED");
    console.error(`远程部署返回 ${result.code}${rolledBack ? "（容器已回滚到上一个镜像）" : ""}${nginxRestored ? "（nginx 配置已恢复）" : ""}`);
    exitCode = 1;
  } else {
    console.log("远程部署完成，开始线上自检 ...");
    const base = SITE_URL || `https://${SITE_HOST}`;
    await fetchChecked(`${base}/healthz`, (text) => text.trim() === "ok");
    await fetchChecked(`${base}/`, (text) => text.includes("PIXEL ARCADE"));
    await fetchChecked(`${base}/play/?game=whack`, (text) => text.includes("PIXEL ARCADE"));
    console.log(`线上自检通过：${base}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        [
          "## VPS 部署",
          "",
          `- 服务器：\`${USER}@${HOST}\``,
          `- 镜像包：${(imageSize / 1024 / 1024).toFixed(1)} MB`,
          `- 地址：${base}`,
          "",
        ].join("\n"),
      );
    }
  }
} catch (error) {
  console.error(`VPS 部署失败：${error?.message ?? error}`);
  exitCode = 1;
} finally {
  client?.end();
}

process.exit(exitCode);
