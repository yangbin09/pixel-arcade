# PIXEL ARCADE · 像素街机

二十款小游戏的浏览器合集。零下载、零登录、零外部素材：所有画面都是 Canvas 像素画，
所有音效都是 WebAudio 现场合成，所有成绩只存在本机。

- 竖屏优先，触屏 / 键盘 / 虚拟手柄三通路
- **复古掌机外壳**：机台边框、CRT 扫描线、开机动画，PAD / CRT 可开关
- 纯静态产物：`vite build` → 一个 `dist/`，Docker 里用 nginx 托管
- 多模块：引擎、样式、UI、清单、20 个游戏各自独立，按需拆包加载

---

## 二十款游戏

### VOL. 01（1–10）

| # | id | 名称 | 类型 | 一局 | 新玩法要点 |
|---|---|---|---|---|---|
| 01 | `whack` | 打地鼠 | 反应 | 30 秒 | 连击倍率、金地鼠 |
| 02 | `snake` | 贪吃蛇 | 街机 | 1–3 分钟 | 固定步进 + 插值、转向队列 |
| 03 | `breakout` | 打砖块 | 街机 | 2–4 分钟 | AABB + 子步进、掉落道具 |
| 04 | `invaders` | 像素入侵者 | 射击 | 2–4 分钟 | 实体池、波次、自动射击 |
| 05 | `blocks` | 俄罗斯方块 | 益智 | 3–8 分钟 | 7-bag、锁延迟、消行动画 |
| 06 | `merge` | 2048 | 益智 | 3–10 分钟 | 滑动合并、一步撤销 |
| 07 | `memory` | 记忆翻牌 | 休闲 | 30 秒–2 分钟 | 翻牌动画、低分计时 |
| 08 | `dodge` | 陨石雨 | 生存 | 45 秒 | 连续转向、护盾、擦身判定 |
| 09 | `tiles` | 别踩白块 | 节奏 | 30–90 秒 | 判定窗口、速度曲线 |
| 10 | `mines` | 像素扫雷 | 逻辑 | 1–5 分钟 | 首点安全、洪水填充、长按插旗 |

### VOL. 02（11–20）

| # | id | 名称 | 类型 | 一局 | 新玩法要点 |
|---|---|---|---|---|---|
| 11 | `runner` | 像素跑酷 | 动作 | 1–2 分钟 | 蓄力跳、滑铲、三段障碍 |
| 12 | `othello` | 像素黑白棋 | 对战 | 2–5 分钟 | 八方向翻转、三局两胜、贪心 AI |
| 13 | `lights` | 关灯谜题 | 益智 | 1–3 分钟 | 十字翻转、保证有解、五关递进 |
| 14 | `stack` | 像素堆塔 | 节奏 | 45–90 秒 | 摆动落点、完美回赠、越堆越快 |
| 15 | `simon` | 记忆节拍 | 记忆 | 30–90 秒 | 序列递增、回放加速、四色四音 |
| 16 | `hoop` | 像素投篮 | 技巧 | 60 秒 | 两段蓄力、空心加成、连中倍率 |
| 17 | `sokoban` | 像素推箱子 | 益智 | 2–5 分钟 | 只推不拉、撤销栈、六关递进 |
| 18 | `hop` | 青蛙过河 | 街机 | 1–3 分钟 | 车道/河道、木头载人、最远行计分 |
| 19 | `claw` | 像素抓娃娃 | 技巧 | 60–90 秒 | 对准度决定概率、三档奖品 |
| 20 | `pong` | 像素乒乓 | 对战 | 1–3 分钟 | 竖屏上下挡板、偏移反弹、七分制 |

## 快速开始

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 类型检查 + vite build + 预压缩
npm run preview      # http://localhost:4173
npm test             # vitest
npm run check:games  # 游戏清单 / 构建产物完整性
```

> 仓库用 npm workspaces。环境里有 pnpm 的话也可以换成 `pnpm install` /
> `pnpm dev`，脚本名一致。

### Docker

```bash
npm run docker:build     # docker build -t pixel-arcade:latest .
npm run docker:up        # docker compose up -d --build
# 打开 http://localhost:8080
```

镜像分两阶段：`node:22-alpine` 里构建，`nginx:1.27-alpine` 里只放静态文件。
运行时只读（`read_only: true` + `tmpfs`），带 `/healthz` 健康检查，
长缓存只给带 hash 的 `assets/`，HTML 永远 `no-cache`。

局域网手机测试：`docker compose up` 后访问 `http://<电脑IP>:8080`。

### CI/CD 与线上部署

GitHub Actions 全自动流水线，详细设计/密钥/回滚手册见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

| 目标 | 地址 | 形态 |
| --- | --- | --- |
| Appwrite Sites | <https://pixel-arcade.appwrite.network> | 静态产物直传 + Appwrite CDN |
| VPS | <https://96-47-231-250.sslip.io> | Docker（nginx:alpine）+ 宿主 nginx + TLS |

流水线（节点解耦，两条发布链路互不影响）：

- **CI**：路径过滤 → 锁文件校验 → typecheck → 单测（2 shard）→ 构建 → 游戏清单 → 无头 Chrome 冒烟 → 体积预算 → Dockerfile 校验 → 门禁
- **Deploy Appwrite** / **Deploy VPS**：`master` 上 CI 成功后各自独立触发（也可手动 `workflow_dispatch` 指定任意 commit）
- **Verify live**：每日定时 + 手动，无头 Chrome 验证两个线上目标；失败自动开 GitHub Issue，恢复后自动关闭
- **Release**：推 `v*` tag 时自动产出 `pixel-arcade-site.zip`、单文件离线版和 SHA256

仓库为 public，`master` 已开分支保护（禁止 force push / 删分支，PR 合并需通过 `CI gate`）。

手动发布 / 回滚：

```bash
# 发布任意 commit 到两个目标（回滚也是同一命令，把 ref 换成上一个好 commit）
gh workflow run deploy-appwrite.yml -f ref=master
gh workflow run deploy-vps.yml       -f ref=master

# 查看运行记录
gh run list
```

本地等价命令：

```bash
npm run ci:lock      # 锁文件与 workspace 一致性检查（CI 同一套）
npm run ci:build     # build:all + 体积预算
npm run ci:smoke     # vite preview + 无头 Chrome 冒烟
npm run ci:verify    # 需要 BASE_URL，验证线上站点
```

旧的本地手工部署脚本仍保留（在服务器上构建，仅应急用）。服务器已关闭 SSH 密码登录，使用部署私钥：

```bash
DEPLOY_HOST=96.47.231.250 DEPLOY_USER=root DEPLOY_KEY=/path/to/vps_deploy_key node scripts/deploy.mjs deploy
```

---

## 目录结构

```
├─ index.html                # 首页（机位网格由 registry + meta 自动生成）
├─ play/index.html           # 播放壳：20 个游戏共用一个页面
├─ site/
│  ├─ home.ts                # 首页入口：收集 meta、生成卡片、画缩略图
│  └─ play.ts                # 播放入口：?game=<id> → 动�� import 对应游戏包
├─ packages/
│  ├─ core/                  # 引擎：画布缩放、循环、输入、音效、HUD、弹窗
│  ├─ ui/                    # 首页卡片组件
│  ├─ registry/              # 机位清单（slots.json）+ meta 校验
│  └─ styles/                # tokens / base / home / play / motion
├─ games/
│  ├─ whack/  snake/  breakout/  invaders/  blocks/
│  ├─ merge/  memory/ dodge/     tiles/     mines/
│  ├─ runner/ othello/ lights/   stack/     simon/
│  ├─ hoop/   sokoban/ hop/      claw/      pong/
│  └─ 每个都是 @arcade/game-<id>，meta.ts 轻量，index.ts 懒加载
├─ scripts/
│  ├─ check-games.mjs        # 清单自检
│  ├─ precompress.mjs        # gzip 预压缩
│  └─ smoke.mjs              # 无头 Chrome 冒烟 + 截图
├─ docs/
│  ├─ GAME_API.md            # 游戏开发契约
│  ├─ game-specs.md          # VOL. 01 十款游戏的玩法规格
│  └─ game-specs-vol02.md    # VOL. 02 十款新游戏的玩法规格
├─ Dockerfile / docker-compose.yml / docker/nginx.conf
└─ vite.config.ts / vite.standalone.config.ts
```

## 多模块是怎么工作的

1. **引擎不依赖任何具体游戏**。`@arcade/core` 只提供画布、循环、输入、音效、
   HUD、弹窗、存档；打地鼠的草丛、地鼠、锤子都在 `games/whack/src/art.ts`。
2. **游戏是插件**。每个包默认导出 `defineGame({ meta, create })`，
   壳层负责开始 / 暂停 / 结算 / 最高分，游戏只写 `start / update / render`。
3. **自动注册**。`site/home.ts` 用 `import.meta.glob('../games/*/src/meta.ts')`
   收集卡片，`site/play.ts` 用 `import.meta.glob('../games/*/src/index.ts')` 懒加载玩法。
   新增游戏不需要改任何公共文件。
4. **按需拆包**。每个游戏编译成 `assets/js/game-<id>-index-<hash>.js` 独立 chunk，
   进哪个游戏才下载哪个；首页只加载 20 份轻量 meta。

新增游戏：读 `docs/GAME_API.md`，复制 `games/whack/` 的结构，
在 `packages/registry/slots.json` 里占一个机位即可。

## 键盘与后台

- 键盘：`P` / 空格 暂停、`M` 静音、`Esc` 暂停。
- 切后台、来电都会自动暂停，回来先看到暂停面板。
- 想要全屏用浏览器自带的 F11，页面样式已适配手动全屏。

## 虚拟手柄与机台

每款游戏在 `meta.ts` 里声明 `pad`，壳层统一画 D-pad、A/B、START：

- 所有 20 款游戏都有手柄布局；没有操作的键不会显示。
- DOM 按钮，天生支持多指（比如俄罗斯方块一边按住左、一边点旋转）。
- 同一动作被两个键按住时用计数处理，不会提前松开。
- Android 用 `navigator.vibrate` 给短振动；iOS 用极短的 WebAudio 按键音。
- 机台顶部 **PAD** 开关收起/展开手柄，**CRT** 开关扫描线与暗角；
  两个状态都写进 `pixelArcade.setting.*`。
- 画面内的触屏按钮/光标可以用 `ctx.padVisible()` 判断是否显示。

写新游戏时看 `docs/GAME_API.md` 的「虚拟手柄」一节。

## 存档

`localStorage`，前缀 `pixelArcade.`（兼容旧版最高分）：

| key | 含义 |
|---|---|
| `pixelArcade.<game>.best` | 高分模式最佳 |
| `pixelArcade.<game>.best.low` | 低分模式最佳（用时/步数） |
| `pixelArcade.muted` | 音效开关 |
| `pixelArcade.setting.pad` | 虚拟手柄开关 |
| `pixelArcade.setting.crt` | CRT 扫描线开关 |
| `pixelArcade.setting.*` | 其他设置 |
| `pixelArcade.schema` | 存档版本 |

## 测试

```bash
npm test                       # 引擎与各游戏纯逻辑单测（300+ 条）
npm run build && npm run preview
node scripts/smoke.mjs         # 无头 Chrome：逐个打开 20 个游戏，检查报错/尺寸/HUD/手柄并截图
```

冒烟脚本输出到 `.artifacts/smoke/`：每个游戏的 `ready` 与 `play` 截图，
以及 `report.json`（状态、HUD、画布尺寸、控制台错误）。
可用 `node scripts/smoke.mjs whack snake` 只跑指定游戏。

## 离线单文件版

```bash
npm run build:standalone
# dist-standalone/index.html —— 双击即可玩，不联网、不要服务器
```

（构建期把 JS/CSS 全部内联，走 `file://` 也能跑。）

## 技术栈

TypeScript 5.9 · Vite 7 · Vitest 3 · 原生 Canvas 2D / WebAudio / Pointer Events ·
nginx 1.27 · 无运行时框架、无第三方 UI 库、无外部资源。
