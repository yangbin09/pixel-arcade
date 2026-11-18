/**
 * 部署到 VPS（Docker + nginx）。
 *
 *   node scripts/deploy.mjs check     # 只读检查：系统、Docker、端口、磁盘
 *   node scripts/deploy.mjs deploy    # 打包源码 → 上传 → 远程 docker build → 重启容器
 *
 * 需要的环境变量（不要写进仓库）：
 *   DEPLOY_HOST      例如 96.47.231.250
 *   DEPLOY_USER      root
 *   DEPLOY_PASSWORD  root 密码（或用 DEPLOY_KEY 指定私钥路径）
 *
 * 部署前请在本地先跑通：npm run typecheck && npm run build
 */
import { Client } from "ssh2";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const HOST = process.env.DEPLOY_HOST;
const USER = process.env.DEPLOY_USER ?? "root";
const PASSWORD = process.env.DEPLOY_PASSWORD;
const KEY_PATH = process.env.DEPLOY_KEY;
const action = process.argv[2] ?? "check";

if (!HOST) {
  console.error("缺少 DEPLOY_HOST");
  process.exit(1);
}

const ROOT = resolve(import.meta.dirname, "..");
const ARTIFACTS = resolve(ROOT, ".artifacts");
const BUNDLE = resolve(ARTIFACTS, "deploy.tar.gz");
const REMOTE_DIR = "/opt/pixel-arcade";
const REMOTE_TGZ = "/tmp/pixel-arcade.tgz";
const CONTAINER = "pixel-arcade";
const IMAGE = "pixel-arcade:latest";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolvePromise, reject) => {
    const client = new Client();
    client
      .on("ready", () => resolvePromise(client))
      .on("error", (error) => reject(error))
      .connect({
        host: HOST,
        port: 22,
        username: USER,
        password: PASSWORD,
        privateKey: KEY_PATH && existsSync(KEY_PATH) ? readFileSync(KEY_PATH) : undefined,
        readyTimeout: 20000,
        keepaliveInterval: 10000,
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

function upload(client, localPath, remotePath) {
  return new Promise((resolvePromise, reject) => {
    client.sftp((error, sftp) => {
      if (error) return reject(error);
      sftp.fastPut(localPath, remotePath, (err) => {
        sftp.end();
        if (err) reject(err);
        else resolvePromise();
      });
    });
  });
}

function makeBundle() {
  mkdirSync(ARTIFACTS, { recursive: true });
  const items = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "vite.standalone.config.ts",
    "vitest.config.ts",
    "index.html",
    "play",
    "standalone",
    "site",
    "packages",
    "games",
    "scripts",
    "public",
    "docs",
    "Dockerfile",
    "docker-compose.yml",
    "docker",
    "deploy",
    "README.md",
    ".dockerignore",
  ].filter((item) => existsSync(resolve(ROOT, item)));

  execFileSync("tar", ["-czf", BUNDLE, "-C", ROOT, ...items], { stdio: "inherit" });
  const size = (statSync(BUNDLE).size / 1024 / 1024).toFixed(2);
  console.log(`打包完成：${BUNDLE} (${size} MB)`);
}

const REMOTE_DEPLOY = `
set -e
echo "== 系统 =="; uname -srm; cat /etc/os-release | head -n 2
echo "== 端口 =="; (ss -ltn || true) | awk 'NR==1 || /:22 |:80 |:443 /'
echo "== Docker =="
command -v docker >/dev/null || { echo "没有 docker"; exit 10; }
systemctl enable --now docker >/dev/null 2>&1 || systemctl start docker
docker version --format '{{.Server.Version}}'
echo "== 解包 =="
rm -rf ${REMOTE_DIR}
mkdir -p ${REMOTE_DIR}
tar -xzf ${REMOTE_TGZ} -C ${REMOTE_DIR}
echo "== 构建 =="
cd ${REMOTE_DIR}
docker build -t ${IMAGE} .
echo "== 重启容器 =="
docker rm -f ${CONTAINER} >/dev/null 2>&1 || true
docker run -d --name ${CONTAINER} --restart unless-stopped \
  -p 127.0.0.1:8080:80 \
  --read-only \
  --tmpfs /var/cache/nginx \
  --tmpfs /var/run \
  --security-opt no-new-privileges:true \
  ${IMAGE}
sleep 4
docker ps --filter name=${CONTAINER} --format '{{.Names}} {{.Status}} {{.Ports}}'
echo "== 容器自检 =="
curl -fsS http://127.0.0.1:8080/healthz

echo "== 宿主 nginx 反代（保留原配置备份） =="
STAMP=$(date +%Y%m%d%H%M%S)
cp -a /etc/nginx/sites-available/games.conf /root/games.conf.bak.$STAMP
install -m 644 /tmp/games-site.conf /etc/nginx/sites-available/games.conf
if nginx -t; then
  systemctl reload nginx
else
  echo "nginx -t 失败，恢复原配置"
  cp -a /root/games.conf.bak.$STAMP /etc/nginx/sites-available/games.conf
  nginx -t && systemctl reload nginx
  exit 20
fi

echo "== 通过 nginx 自检 =="
curl -fsS -H 'Host: 96-47-231-250.sslip.io' http://127.0.0.1/healthz
curl -kfsS -o /dev/null -w 'HTTPS %{http_code}\\n' -H 'Host: 96-47-231-250.sslip.io' https://127.0.0.1/
curl -kfsS -o /dev/null -w 'PLAY HTTPS %{http_code}\\n' -H 'Host: 96-47-231-250.sslip.io' 'https://127.0.0.1/play/?game=whack'
echo "备份：/root/games.conf.bak.$STAMP"
`;

try {
  console.log(`连接 ${USER}@${HOST} ...`);
  const client = await connect();
  console.log("已连接。");

  if (action === "check") {
    const result = await exec(
      client,
      [
        "uname -srm",
        "head -n 2 /etc/os-release",
        "(ss -ltn || true) | awk 'NR==1 || /:22 |:80 |:443 /'",
        "free -m | head -n 2",
        "df -h / | tail -n 1",
        "command -v docker && (systemctl is-active docker || true) && (docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'docker daemon 未启动')",
        "command -v nginx && (systemctl is-active nginx || true)",
        "which tar gzip",
      ].join("; "),
      { stream: true },
    );
    console.log(`\n检查完成（exit ${result.code}）。`);
  } else if (action === "probe") {
    const result = await exec(
      client,
      [
        "echo '== sites-enabled =='",
        "ls -l /etc/nginx/sites-enabled/ 2>/dev/null || true",
        "echo '== nginx server blocks =='",
        "nginx -T 2>/dev/null | grep -E '^[[:space:]]*(server_name|root|listen)' | head -30 || true",
        "echo '== docker ps =='",
        "docker ps --format '{{.Names}} | {{.Image}} | {{.Ports}}' || true",
        "echo '== docker images =='",
        "docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | head -10 || true",
        "echo '== /var/www/games =='",
        "ls -la /var/www/games 2>/dev/null | head -15 || true",
        "echo '== index head =='",
        "head -c 300 /var/www/games/index.html 2>/dev/null || true",
        "echo",
        "echo '== games.conf =='",
        "cat /etc/nginx/sites-available/games.conf 2>/dev/null | head -40 || true",
        "echo '== certs =='",
        "ls /etc/letsencrypt/live 2>/dev/null || true",
      ].join("; "),
      { stream: true },
    );
    console.log(`\nprobe 完成（exit ${result.code}）。`);
  } else if (action === "deploy") {
    makeBundle();
    console.log("上传源码包与站点配置 ...");
    await upload(client, BUNDLE, REMOTE_TGZ);
    await upload(client, resolve(ROOT, "deploy/games-site.conf"), "/tmp/games-site.conf");
    console.log("远程构建并启动（首次构建约 1–3 分钟）...");
    const result = await exec(client, REMOTE_DEPLOY, { stream: true });
    if (result.code !== 0) {
      console.error(`\n远程部署失败，exit ${result.code}`);
      process.exitCode = 1;
    } else {
      await sleep(500);
      console.log(`\n部署完成：http://${HOST}/`);
    }
  } else {
    console.error(`未知动作：${action}（只支持 check / deploy）`);
    process.exitCode = 1;
  }

  client.end();
} catch (error) {
  console.error("部署失败：", error?.message ?? error);
  process.exitCode = 1;
}
