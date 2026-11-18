# PIXEL ARCADE · 像素街机

十款小游戏的浏览器合集。零下载、零登录、零外部素材：所有画面都是 Canvas 像素画，
所有音效都是 WebAudio 现场合成，所有成绩只存在本机。

- 竖屏优先，触屏 / 键盘双通路
- **全屏运行**：原生全屏 + iPhone 沉浸回退 + 自动锁竖屏 + 屏幕唤醒锁
- 纯静态产物：`vite build` → 一个 `dist/`，Docker 里用 nginx 托管
- 多模块：引擎、样式、UI、清单、10 个游戏各自独立，按需拆包加载

---

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
点开始会自动进全屏（iPhone Safari 走沉浸模式）。

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
| iPhone Safari（不支持元素全屏） | `body.is-immersive`：`100dvh` + 隐藏页框 + safe-area |
| 都不支持 | 画布放到最大，提示用 F11 |

- 触屏设备点「开始游戏」会在同一个用户手势里顺带请求全屏（成功率最高）。
- 全屏时顶栏 2.6 秒后自动淡出，触摸/移动/按键唤回；HUD 与计时条常显。
- 进入全屏申请 `navigator.wakeLock('screen')`，切后台或退出时释放。
- 退出全屏、切后台、来电都会自动暂停，回来先看到暂停面板。
- 键盘：`F` 全屏、`P` / 空格 暂停、`M` 静音、`Esc` 退出全屏或暂停。

## 存档

`localStorage`，前缀 `pixelArcade.`（兼容旧版最高分）：

| key | 含义 |
|---|---|
| `pixelArcade.<game>.best` | 高分模式最佳 |
| `pixelArcade.<game>.best.low` | 低分模式最佳（用时/步数） |
| `pixelArcade.muted` | 音效开关 |
| `pixelArcade.setting.*` | 其他设置 |
| `pixelArcade.schema` | 存档版本 |

## 测试

```bash
npm test                       # 引擎与各游戏纯逻辑单测
npm run build && npm run preview
node scripts/smoke.mjs         # 无头 Chrome：逐个打开 10 个游戏，检查报错/尺寸/HUD 并截图
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
