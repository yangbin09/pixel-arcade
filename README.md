# PIXEL ARCADE · 像素街机

十款小游戏的浏览器合集。零下载、零登录、零外部素材：所有画面都是 Canvas 像素画，
所有音效都是 WebAudio 现场合成，所有成绩只存在本机。

- 竖屏优先，触屏 / 键盘 / 虚拟手柄三通路
- **复古掌机外壳**：机台边框、CRT 扫描线、开机动画，PAD / CRT 可开关
- **全屏运行**：原生全屏 + 自动锁竖屏 + 屏幕唤醒锁；iPhone 可「添加到主屏幕」获得真全屏
- 纯静态产物：`vite build` → 一个 `dist/`，Docker 里用 nginx 托管
- 多模块：引擎、样式、UI、清单、10 个游戏各自独立，按需拆包加载

---

## 十款游戏

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

局域网手机测试：`docker compose up` 后访问 `http://<电脑IP>:8080`，
点开始会自动进全屏。iPhone Safari 不支持网页元素全屏，按提示「添加到主屏幕」
从桌面打开才是没有地址栏/底栏的真全屏。

### 部署到 VPS

仓库自带一个基于 `ssh2` 的部署脚本（不依赖 pnpm/rsync/PuTTY）：

```bash
# 只读检查：系统、Docker、端口、磁盘
DEPLOY_HOST=<ip> DEPLOY_USER=root DEPLOY_PASSWORD=<password> node scripts/deploy.mjs check

# 打包源码 → 上传 → 服务器上 docker build → 重启容器 → 刷新 nginx 反代
DEPLOY_HOST=<ip> DEPLOY_USER=root DEPLOY_PASSWORD=<password> node scripts/deploy.mjs deploy
```

部署形态：容器只监听 `127.0.0.1:8080`，宿主 nginx 负责 TLS 与 80→443 跳转，
`deploy/games-site.conf` 是反代配置（安装前会备份原配置，`nginx -t` 失败自动回滚）。
密码只通过环境变量传入，不要写进文件或提交到仓库。

线上检查与回滚：

```bash
ssh root@<ip> 'docker ps --filter name=pixel-arcade'
ssh root@<ip> 'docker logs --tail 50 pixel-arcade'
ssh root@<ip> 'curl -fsS http://127.0.0.1:8080/healthz'

# 回滚 nginx（换回旧的静态站点，旧文件仍在 /var/www/games）
ssh root@<ip> 'ls /root/games.conf.bak.* | tail -1'
ssh root@<ip> 'cp /root/games.conf.bak.<时间戳> /etc/nginx/sites-available/games.conf && nginx -t && systemctl reload nginx'
```

---

## 目录结构

```
├─ index.html                # 首页（机位网格由 registry + meta 自动生成）
├─ play/index.html           # 播放壳：10 个游戏共用一个页面
├─ site/
│  ├─ home.ts                # 首页入口：收集 meta、生成卡片、画缩略图
│  └─ play.ts                # 播放入口：?game=<id> → 动�� import 对应游戏包
├─ packages/
│  ├─ core/                  # 引擎：画布缩放、循环、输入、音效、HUD、弹窗、全屏
│  ├─ ui/                    # 首页卡片组件
│  ├─ registry/              # 机位清单（slots.json）+ meta 校验
│  └─ styles/                # tokens / base / home / play / motion
├─ games/
│  ├─ whack/  snake/  breakout/  invaders/  blocks/
│  ├─ merge/  memory/ dodge/     tiles/     mines/
│  └─ 每个都是 @arcade/game-<id>，meta.ts 轻量，index.ts 懒加载
├─ scripts/
│  ├─ check-games.mjs        # 清单自检
│  ├─ precompress.mjs        # gzip 预压缩
│  └─ smoke.mjs              # 无头 Chrome 冒烟 + 截图
├─ docs/
│  ├─ GAME_API.md            # 游戏开发契约
│  └─ game-specs.md          # 十款游戏的玩法规格
├─ Dockerfile / docker-compose.yml / docker/nginx.conf
└─ vite.config.ts / vite.standalone.config.ts
```

## 多模块是怎么工作的

1. **引擎不依赖任何具体游戏**。`@arcade/core` 只提供画布、循环、输入、音效、
   HUD、弹窗、存档、全屏；打地鼠的草丛、地鼠、锤子都在 `games/whack/src/art.ts`。
2. **游戏是插件**。每个包默认导出 `defineGame({ meta, create })`，
   壳层负责开始 / 暂停 / 结算 / 最高分 / 全屏，游戏只写 `start / update / render`。
3. **自动注册**。`site/home.ts` 用 `import.meta.glob('../games/*/src/meta.ts')`
   收集卡片，`site/play.ts` 用 `import.meta.glob('../games/*/src/index.ts')` 懒加载玩法。
   新增游戏不需要改任何公共文件。
4. **按需拆包**。每个游戏编译成 `assets/js/game-<id>-index-<hash>.js` 独立 chunk，
   进哪个游戏才下载哪个；首页只加载 10 份轻量 meta。

新增游戏：读 `docs/GAME_API.md`，复制 `games/whack/` 的结构，
在 `packages/registry/slots.json` 里占一个机位即可。

## 全屏

`@arcade/core` 的 `FullscreenController` 三层策略：

| 设备 | 行为 |
|---|---|
| 桌面 Chrome/Edge、Android、iPad | `requestFullscreen({ navigationUI: "hide" })` + `orientation.lock("portrait")` |
| iPhone Safari（不支持元素全屏） | `body.is-immersive`：`100dvh` + 隐藏页框 + safe-area；底栏是浏览器 UI，网页无法隐藏 |
| 都不支持 | 画布放到最大，提示用 F11 |

**iPhone 的真全屏**：Safari 不允许网页隐藏地址栏/底栏。唯一稳定的方案是
「分享 → 添加到主屏幕」，从桌面以 PWA 打开：没有地址栏和底栏，状态栏与
home indicator 仍在（系统 UI）。首次进游戏会自动弹一次像素风引导；
点全屏按钮也会再打开。主屏幕版是独立存储，最高分和 Safari 不互通。

- 触屏设备点「开始游戏」会在同一个用户手势里顺带请求全屏（成功率最高）。
- 全屏时顶栏 2.6 秒后自动收起（真正释放高度），触摸/移动/按键唤回；HUD 与计时条常显。
- iPhone 非 PWA 时给手柄预留约 50px 底部空间，避免 D-pad 被 Safari 底栏压住。
- 进入全屏申请 `navigator.wakeLock('screen')`，切后台或退出时释放。
- 退出全屏、切后台、来电都会自动暂停，回来先看到暂停面板。
- 键盘：`F` 全屏、`P` / 空格 暂停、`M` 静音、`Esc` 退出全屏或暂停。

## 虚拟手柄与机台

每款游戏在 `meta.ts` 里声明 `pad`，壳层统一画 D-pad、A/B、START：

- 所有 10 款游戏都有手柄布局；没有操作的键不会显示。
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
| `pixelArcade.setting.pwa.tip` | iPhone 安装引导是否已读 |
| `pixelArcade.setting.*` | 其他设置 |
| `pixelArcade.schema` | 存档版本 |

## 测试

```bash
npm test                       # 引擎与各游戏纯逻辑单测（200+ 条）
npm run build && npm run preview
node scripts/smoke.mjs         # 无头 Chrome：逐个打开 10 个游戏，检查报错/尺寸/HUD/手柄并截图
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
