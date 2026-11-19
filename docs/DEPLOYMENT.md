# 部署与 CI/CD

项目的持续集成与持续部署全部跑在 GitHub Actions 上。目标是「一次构建、按节点解耦、两条发布链路互不影响」：

```
push / PR
   │
   ▼
┌──────────────────────────────── CI 工作流（质量门禁）────────────────────────────────┐
│ changes(路径过滤) → typecheck → unit(2 shards) → build ─┬→ games-check            │
│                                                         ├→ smoke(无头 Chrome)   │
│                                                         ├→ bundle(体积预算)     │
│                                                         └→ image(Dockerfile)    │
│                                                                     ↓            │
│                                                                  gate            │
└──────────────────────────────────────────────────────────────────────────────────┘
                    │ master 成功（workflow_run）
        ┌───────────┴────────────┐
        ▼                        ▼
┌─ Deploy Appwrite ─┐   ┌─ Deploy VPS ──────────────┐
│ build site        │   │ build image               │
│   ↓ site-dist     │   │   ↓ docker-image          │
│ Appwrite Sites API│   │ SSH: docker load + 重启   │
│   ↓               │   │   + 健康检查 / 自动回滚   │
│ 无头 Chrome 验证  │   │   + nginx 反代热更新      │
└───────────────────┘   └───────────────────────────┘
        │                        │
        └────────┬───────────────┘
                 ▼
        每日 03:17 UTC 定时巡检（两个目标各自独立 job）
```

## 线上目标

| 目标 | 地址 | 形态 |
| --- | --- | --- |
| Appwrite Sites（CDN） | <https://pixel-arcade.appwrite.network> | 静态产物直传，Appwrite 边缘分发 |
| VPS | <https://96-47-231-250.sslip.io> | Docker 容器（nginx:alpine）+ 宿主 nginx 反代 + Let's Encrypt TLS |

两个目标内容完全一致，都是同一个 `dist/` 构建产物；但发布链路完全独立，任一失败不影响另一个。

## 流水线节点

### 1. `ci.yml` —— 质量门禁（push / PR / 手动）

| 节点 | 作用 | 依赖 | 备注 |
| --- | --- | --- | --- |
| `changes` | `dorny/paths-filter` 判断是否只改文档 | — | 文档-only 改动跳过代码节点 |
| `typecheck` | `tsc --noEmit` | changes | |
| `unit` | `vitest` 分 2 shard 并行 | changes | 失败互不阻塞（`fail-fast: false`） |
| `build` | 复用 `reusable-build-site.yml` | changes | 产出 `site-dist` artifact |
| `games-check` | 机位清单 + 每款游戏独立 chunk | build | 校验构建产物完整性 |
| `smoke` | `vite preview` + 无头 Chrome 跑 20 款游戏 | build | 控制台错误 / 未进入 playing 即失败 |
| `bundle` | gzip 体积预算（`bundle-budget.json`） | build | 防止误引入大依赖 |
| `image` | 复用 `reusable-build-image.yml` | changes | 验证 Dockerfile，导出镜像 artifact |
| `audit` | `npm audit --audit-level=high` | changes | 仅提示，不参与门禁 |
| `gate` | 汇总结果 | 以上 | `failure` / `cancelled` 才失败，`skipped` 允许 |

### 2. `reusable-build-site.yml` —— 可复用构建节点

`workflow_call`：checkout → `npm ci` → `npm run build:all`（typecheck + vite + 单文件版 + 预压缩）→ 体积预算 → 上传 `site-dist`。

被 `ci.yml`、`deploy-appwrite.yml`、`release.yml` 三处复用，避免构建逻辑复制粘贴。

### 3. `reusable-build-image.yml` —— 可复用镜像节点

`workflow_call`：Buildx（GHA 缓存）→ `docker build` → `docker save | gzip` → 上传 `docker-image`。

### 4. `deploy-appwrite.yml` —— Appwrite 发布（独立）

触发方式：

- `workflow_run`：`CI` 在 `master` 上成功完成后自动触发；
- `workflow_dispatch`：手动指定任意 `ref`（用于回滚/补发）。

节点：`build`（复用站点构建）→ `deploy`（Appwrite REST API 创建部署并激活）→ `verify`（无头 Chrome 验证线上站点）。

部署脚本：`scripts/ci/deploy-appwrite.mjs`，只调用「创建部署 + 激活」接口，**不修改站点名称、域名规则、构建配置**。失败时旧部署继续在线。

### 5. `deploy-vps.yml` —— VPS 发布（独立）

与 Appwrite 链路相同的触发方式，节点为 `build`（复用镜像构建）→ `deploy`（SSH）→ `verify`。

部署脚本：`scripts/ci/deploy-vps.mjs`：

1. SFTP 上传 `pixel-arcade-image.tar.gz` 与 `deploy/games-site.conf`；
2. 服务器 `docker load`，把当前 `pixel-arcade:latest` 打成 `pixel-arcade:rollback` 备份；
3. `docker rm -f` 旧容器，按固定参数启动新容器（`--read-only` + tmpfs + `no-new-privileges`）；
4. `/healthz` 健康检查失败 → 自动用 `pixel-arcade:rollback` 重启并退出；
5. 更新 `/etc/nginx/sites-available/games.conf`（先备份到 `/root/games.conf.bak.<时间戳>`），`nginx -t` 失败自动恢复；
6. 通过宿主 nginx 自检 `http://127.0.0.1/healthz` 与 HTTPS；
7. Action 侧再对公网 `https://<VPS_SITE_HOST>/` 做一次 HTTP 自检。

SSH 使用专用 ed25519 部署密钥（`restrict` 前缀，只允许执行命令，禁止端口转发/agent 转发），并强制校验主机指纹。

### 6. `verify-live.yml` —— 定时巡检（独立）

每天 03:17 UTC（北京时间 11:17）分别对 Appwrite 与 VPS 跑一遍无头 Chrome 功能验证；两个 job 互相独立。也可手动 `workflow_dispatch`。

巡检失败会自动创建/更新 GitHub Issue（标题：`线上巡检失败（Appwrite / VPS）`）；下一次巡检成功后自动关闭该 issue。两个部署流水线同样会在失败时开 `部署失败（Appwrite/VPS）` issue，成功部署后自动关闭。

### 7. `release.yml` —— 版本发布（tag）

推 `v*` tag 时构建并发布 GitHub Release 资产：

- `pixel-arcade-site.zip`：完整静态站，可直接丢给任意静态托管；
- `pixel-arcade-standalone.html`：单文件离线版；
- `SHA256SUMS.txt`：校验和。

## 解耦设计说明

1. **构建一次，多处复用**：两个 `reusable-*.yml` 通过 `workflow_call` 被 CI / 部署 / Release 共用；部署流水线内部自带构建节点，因此任何一条部署都可以单独手动重放，不依赖 CI 的 artifact 生命周期。
2. **两条发布链路完全独立**：Appwrite 与 VPS 是两个 workflow，各自 `concurrency` 串行、各自重试；Appwrite 配额或 VPS 网络出问题不会阻塞另一条。
3. **密钥按 Environment 隔离**：`production-appwrite` 只挂 Appwrite API Key；`production-vps` 只挂 VPS SSH Key。发布 job 没有跨目标权限。
4. **验证与发布分离**：`verify` 是独立 job（独立 runner、独立 Chrome），部署 job 只负责上传/重启。线上功能问题不会被「部署成功」掩盖。
5. **职责拆到脚本**：`scripts/ci/*.mjs` 是纯 Node、跨平台脚本，本地可单独执行；workflow 只负责编排和传参。
6. **文档改动不跑重活**：`changes` 节点做路径过滤，只改 `docs/` / `README.md` 时跳过 typecheck/unit/smoke 等，但部署仍会构建（保证产物一致）。

## 首次配置（已完成，供复现/重建参考）

仓库：<https://github.com/yangbin09/pixel-arcade>（public；`master` 已开分支保护）

### 仓库变量（Settings → Variables）

| 名称 | 值 |
| --- | --- |
| `APPWRITE_SITE_URL` | `https://pixel-arcade.appwrite.network` |
| `VPS_SITE_URL` | `https://96-47-231-250.sslip.io` |

### Environment `production-appwrite`

变量：

| 名称 | 值 |
| --- | --- |
| `APPWRITE_ENDPOINT` | `https://cloud.appwrite.io/v1` |
| `APPWRITE_PROJECT_ID` | `xiaoyangai` |
| `APPWRITE_SITE_ID` | `pixel-arcade` |
| `APPWRITE_SITE_URL` | `https://pixel-arcade.appwrite.network` |

Secret：

| 名称 | 说明 |
| --- | --- |
| `APPWRITE_API_KEY` | 项目 API Key，范围仅 `sites.read` + `sites.write`，有效期 1 年 |

### Environment `production-vps`

变量：

| 名称 | 值 |
| --- | --- |
| `VPS_HOST` | `96.47.231.250` |
| `VPS_PORT` | `22` |
| `VPS_USER` | `root` |
| `VPS_HOST_FINGERPRINT` | `SHA256:7fB24dhvAO4Ql+4Xne/NGZ1x8UKwS30KQTAj2Kz7ZGY` |
| `VPS_SITE_HOST` | `96-47-231-250.sslip.io` |
| `VPS_SITE_URL` | `https://96-47-231-250.sslip.io` |

Secret：

| 名称 | 说明 |
| --- | --- |
| `VPS_SSH_KEY` | 专用 ed25519 私钥（OpenSSH 格式） |

### 用 gh 重建配置

```bash
# 仓库变量
gh variable set APPWRITE_SITE_URL --repo yangbin09/pixel-arcade --body "https://pixel-arcade.appwrite.network"
gh variable set VPS_SITE_URL      --repo yangbin09/pixel-arcade --body "https://96-47-231-250.sslip.io"

# Appwrite 环境
gh api --method PUT repos/yangbin09/pixel-arcade/environments/production-appwrite
gh variable set APPWRITE_ENDPOINT   --repo yangbin09/pixel-arcade --env production-appwrite --body "https://cloud.appwrite.io/v1"
gh variable set APPWRITE_PROJECT_ID --repo yangbin09/pixel-arcade --env production-appwrite --body "xiaoyangai"
gh variable set APPWRITE_SITE_ID    --repo yangbin09/pixel-arcade --env production-appwrite --body "pixel-arcade"
gh variable set APPWRITE_SITE_URL   --repo yangbin09/pixel-arcade --env production-appwrite --body "https://pixel-arcade.appwrite.network"
gh secret   set APPWRITE_API_KEY    --repo yangbin09/pixel-arcade --env production-appwrite

# VPS 环境
gh api --method PUT repos/yangbin09/pixel-arcade/environments/production-vps
gh variable set VPS_HOST             --repo yangbin09/pixel-arcade --env production-vps --body "96.47.231.250"
gh variable set VPS_PORT             --repo yangbin09/pixel-arcade --env production-vps --body "22"
gh variable set VPS_USER             --repo yangbin09/pixel-arcade --env production-vps --body "root"
gh variable set VPS_HOST_FINGERPRINT --repo yangbin09/pixel-arcade --env production-vps --body "SHA256:7fB24dhvAO4Ql+4Xne/NGZ1x8UKwS30KQTAj2Kz7ZGY"
gh variable set VPS_SITE_HOST        --repo yangbin09/pixel-arcade --env production-vps --body "96-47-231-250.sslip.io"
gh variable set VPS_SITE_URL         --repo yangbin09/pixel-arcade --env production-vps --body "https://96-47-231-250.sslip.io"
gh secret   set VPS_SSH_KEY          --repo yangbin09/pixel-arcade --env production-vps < deploy_key
```

### 轮换凭据

**Appwrite API Key**（每年一次）：

1. Appwrite Console → 项目 `xiaoyangai` → Overview → API keys → 新建 key，范围 `sites.read` + `sites.write`；
2. `gh secret set APPWRITE_API_KEY --env production-appwrite` 写入新值；
3. 手动跑一次 `gh workflow run deploy-appwrite.yml -f ref=master` 验证；
4. 确认新部署成功后，在 Console 删除旧 key。

**VPS 部署密钥**（怀疑泄露时）：

```bash
# 1) 本地生成新密钥
ssh-keygen -t ed25519 -C "pixel-arcade-ci-$(date +%Y%m)" -f deploy_key -N ""

# 2) 把公钥装到服务器（restrict 限制用途）
PUB=$(cat deploy_key.pub)
ssh root@96.47.231.250 "grep -qF '$PUB' /root/.ssh/authorized_keys || echo 'restrict $PUB' >> /root/.ssh/authorized_keys"

# 3) 更新 GitHub secret 后手动发一次部署验证
gh secret set VPS_SSH_KEY --env production-vps < deploy_key

# 4) 验证通过后从服务器删除旧公钥（按注释里旧的日期匹配）
ssh root@96.47.231.250 "sed -i '/pixel-arcade-ci-2026-11/d' /root/.ssh/authorized_keys"
```

## 日常操作

```bash
# 手动发布当前 master 到两个目标
gh workflow run deploy-appwrite.yml --repo yangbin09/pixel-arcade -f ref=master
gh workflow run deploy-vps.yml       --repo yangbin09/pixel-arcade -f ref=master

# 查看运行状态
gh run list --repo yangbin09/pixel-arcade
gh run watch <run-id> --repo yangbin09/pixel-arcade

# 手动巡检
gh workflow run verify-live.yml --repo yangbin09/pixel-arcade
```

本地等价命令（不经过 GitHub）：

```bash
npm run ci:build       # 双产物构建 + 体积预算
npm run ci:smoke       # vite preview + 无头 Chrome 冒烟
npm run ci:bundle      # 单独检查体积预算

# Appwrite：需要 API Key 环境变量
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1 \
APPWRITE_PROJECT_ID=xiaoyangai \
APPWRITE_SITE_ID=pixel-arcade \
APPWRITE_SITE_URL=https://pixel-arcade.appwrite.network \
APPWRITE_API_KEY=... \
node scripts/ci/deploy-appwrite.mjs

# 线上验证（任意目标）
BASE_URL=https://pixel-arcade.appwrite.network node scripts/ci/verify-live.mjs
```

## 回滚手册

### Appwrite

按优先级：

1. **重跑上一个好版本**（推荐）：`gh workflow run deploy-appwrite.yml -f ref=<上一个可用 commit SHA>`。部署脚本会创建新部署并激活，旧部署不受影响。
2. **Appwrite Console 回滚**：Sites → `pixel-arcade` → Deployments → 选择上一个 `ready` 的部署 → 激活（activate）。部署脚本运行时会打印最近几个部署 id，便于定位。
3. 站点结构（名称 / 域名规则 / 构建配置）不随部署变化，不需要回滚。

### VPS

```bash
# 方式 1：重跑上一个好版本（自动化，推荐）
gh workflow run deploy-vps.yml -f ref=<上一个可用 commit SHA>

# 方式 2：服务器上直接切回上一个镜像（应急，秒级）
ssh root@96.47.231.250 'docker rm -f pixel-arcade && \
  docker run -d --name pixel-arcade --restart unless-stopped \
    -p 127.0.0.1:8080:80 --read-only \
    --tmpfs /var/cache/nginx --tmpfs /var/run \
    --security-opt no-new-privileges:true pixel-arcade:rollback'

# 方式 3：恢复上一次 nginx 反代配置
ssh root@96.47.231.250 'ls -1 /root/games.conf.bak.* | tail -1'
ssh root@96.47.231.250 'cp /root/games.conf.bak.<时间戳> /etc/nginx/sites-available/games.conf && nginx -t && systemctl reload nginx'
```

`deploy-vps.mjs` 在健康检查失败时会**自动**执行方式 2；nginx `-t` 失败时会自动恢复备份，不需要人工介入。

## 安全边界

- 仓库是 public；仓库内**不含**任何密码/私钥/API Key（已对全部 git 历史做过扫描）。
- `master` 已开分支保护：禁止 force push 与删除分支；合并 PR 必须通过 `CI gate`（管理员可绕过，便于紧急修复）。
- Appwrite API Key 仅 `sites.read` + `sites.write`，只能发布站点，不能删站点、不能碰数据库/用户/存储；有效期 1 年（到期前按上文轮换）。
- VPS 使用**专用**部署密钥（`authorized_keys` 里带 `restrict` 选项），并且**已关闭 root 密码登录**：`PermitRootLogin prohibit-password`、`PasswordAuthentication no`（drop-in：`/etc/ssh/sshd_config.d/00-pixel-arcade-hardening.conf`，配置备份在服务器 `/root/sshd-backup-*`）。
- 主机指纹在 workflow 变量中锁定，SSH 客户端会校验，防中间人。
- GitHub Environment `production-*` 目前未启用审批规则（public 仓库已具备条件）；需要「发布需人工审批」时，在仓库 Settings → Environments 给两个环境加 required reviewers 即可。
- VPS 救援入口：DediRock 面板 VNC 控制台。本地应急部署使用 `.artifacts/gh-setup/vps_deploy_key`（gitignored）或从 CI 重新轮换密钥。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| Appwrite 部署 401/403 | API Key 是否过期、是否包含 `sites.read` + `sites.write`、`APPWRITE_PROJECT_ID` 是否 `xiaoyangai` |
| Appwrite 部署卡在 processing | Appwrite Console → 站点 → Deployments 看构建日志；免费计划单次构建上限 15 分钟 |
| VPS deploy 报 SSH 认证失败 | `VPS_SSH_KEY` 换行是否完整；服务器 `/root/.ssh/authorized_keys` 是否有 `restrict` 公钥；`fail2ban` 是否封了 runner IP（`fail2ban-client status sshd`） |
| VPS 部署后 502 | 容器健康检查是否通过：`ssh ... 'docker ps; docker logs --tail 100 pixel-arcade'` |
| 无头 Chrome 找不到 | 脚本支持 `CHROME_PATH` 覆盖；ubuntu-latest 自带 `google-chrome` |
| 偶发 `Chrome DevTools 没有启动` | 脚本已内置 45s 启动等待 + stderr 诊断；偶发冷启动慢直接 rerun 失败 job；持续失败时检查 runner 上 `google-chrome --version` 是否可执行 |
| SSH 密码登录被拒绝 | 服务器已关闭密码登录，只允许部署密钥；本地手工部署改用 `DEPLOY_KEY=... node scripts/deploy.mjs deploy`，救援走 DediRock 面板 VNC 控制台 |
| 冒烟失败但本地正常 | CI 是 `SMOKE_STRICT=1`（控制台错误也算失败），看 action 里的 `smoke-report` artifact |
| `workflow_run` 部署没触发 | 只有 CI 在 `master` 上 `conclusion=success` 才触发；PR 不会触发部署 |

## 上线验证记录

2026-11-18 首次接入完成后的实测结果：

| 链路 / 节点 | 结果 |
| --- | --- |
| CI 门禁（路径过滤 → typecheck → 单测 203 项分 2 shard → 双产物构建 → 游戏清单 → 无头冒烟 → 体积预算 → 镜像 → gate） | ✅ 全绿 |
| Appwrite 发布（构建 → 上传部署 → 激活 → 线上验证） | ✅ 部署 `ready`，线上 10/10 游戏可玩、0 控制台错误 |
| VPS 发布（镜像构建 → SSH 上传 → 容器重启/健康检查 → nginx 反代 → 线上验证） | ✅ 部署成功，容器 healthy，线上 10/10 游戏可玩、0 控制台错误 |
| 定时巡检（verify-live.yml） | ✅ 两个目标 job 独立可手动触发，已排定每日 11:17（北京时间）自动运行 |
| Release（v* tag → 构建 + GitHub Release 资产） | ✅ `v1.0.0` 已验证（site.zip / 单文件离线版 / SHA256SUMS） |

## 相关文件

```
.github/
  actions/prepare/action.yml          # 安装 Node + npm ci
  workflows/ci.yml                    # 质量门禁
  workflows/reusable-build-site.yml   # 可复用静态构建
  workflows/reusable-build-image.yml  # 可复用镜像构建
  workflows/deploy-appwrite.yml       # Appwrite 发布链路
  workflows/deploy-vps.yml            # VPS 发布链路
  workflows/verify-live.yml           # 定时巡检
  workflows/release.yml               # tag 发布
  dependabot.yml                      # 依赖更新
scripts/
  lib/find-chrome.mjs                 # 跨平台 Chrome 定位
  ci/bundle-budget.mjs                # 体积预算
  ci/smoke-preview.mjs                # preview + 冒烟
  ci/verify-live.mjs                  # 线上功能验证
  ci/deploy-appwrite.mjs              # Appwrite 部署
  ci/deploy-vps.mjs                   # VPS 部署
  ci/ci-gate.mjs                      # CI 门禁汇总
  deploy.mjs                          # 旧的本地手工部署（密码方式，保留）
```
