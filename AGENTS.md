# PIXEL ARCADE · 项目工作约定

> 这份文件由 DSH 在会话启动时自动载入（项目级，优先级高于 `~/.dsh/AGENTS.md` 的全局准则）。
> 跨项目的通用教训在全局文件里；这里只写**这个仓库特有**的规则。

## 这是什么

像素街机小游戏合集：30 款 Canvas 小游戏，纯静态产物。
零外部素材（画面全是 Canvas 像素画、音效全是 WebAudio 现场合成）、零运行时框架。

- 技术栈：TypeScript 5.9 · Vite 7 · Vitest 3 · 原生 Canvas 2D
- 多模块：npm workspaces，`packages/*` + `games/*`
- 部署：Appwrite Sites 与 VPS（Docker + nginx），由 GitHub Actions 自动发布

## 先读哪份文档

| 你要做什么 | 读这个 |
|---|---|
| 写一款新游戏 | [`docs/game-dev-card.md`](docs/game-dev-card.md) —— **速查卡，先读这份**；完整契约见 [`docs/GAME_API.md`](docs/GAME_API.md) |
| 看已有玩法规格 | [`docs/game-specs.md`](docs/game-specs.md)（VOL.01）、[`docs/game-specs-vol02.md`](docs/game-specs-vol02.md)（VOL.02）、[`docs/game-specs-vol03.md`](docs/game-specs-vol03.md)（VOL.03） |
| 改部署/CI | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| 参考实现 | `games/mines/`（网格+光标+低分模式）、`games/whack/`（反应类） |

---

## 一、架构：游戏是插件，自动发现

这是最重要的设计，**决定了加游戏不需要改任何公共文件**：

```ts
// site/home.ts —— 首页收集卡片
import.meta.glob<{ meta: GameMeta }>("../games/*/src/meta.ts", { eager: true })
// site/play.ts —— 播放壳懒加载玩法
import.meta.glob<{ meta: GameMeta }>("../games/*/src/index.ts")
```

因此：
- **新增游戏 = 新建 `games/<id>/` 目录**，不要改 `site/`、`index.html`、`play/`。
- 每个游戏编译成 `assets/js/game-<id>-index-<hash>.js` 独立 chunk（由
  [`vite.config.ts`](vite.config.ts) 的 `chunkFileNames` 按路径正则决定）——
  **改这个正则会破坏 `check:games` 的产物校验**。
- 进哪个游戏才下载哪个；首页只加载 30 份轻量 `meta.ts`。

## 二、加一款新游戏的完整清单

### 1. 目录结构（6 个文件）

```
games/<id>/
├─ package.json        # @arcade/game-<id>，exports 指向 src
├─ src/meta.ts         # 轻量元数据 + drawThumb（首页 eager 加载，别 import 重东西）
├─ src/index.ts        # export default defineGame({ meta, create })
├─ src/logic.ts        # 纯函数规则层，不碰 DOM，随机源由调用方注入
├─ src/art.ts          # 像素素材绘制，meta 的 drawThumb 复用它
└─ test/<id>.test.ts   # 只测 logic.ts（node 环境，无 DOM）
```

`package.json` 照抄 `games/mines/package.json`，只改包名。

### 2. 机位登记

在 [`packages/registry/slots.json`](packages/registry/slots.json) 里加一行：

```json
{ "no": 21, "id": "<id>" }
```

**机位号必须连续且唯一**，`meta.ts` 里的 `no` 必须与之一致（`check:games` 会校验）。
顺序由这个文件决定，不是目录名。

### 3. 四步门禁（缺一不可）

```bash
npx tsc -p tsconfig.json --noEmit     # 1. 类型
npx vitest run games/<id>             # 2. 单测（≥12 条，只测 logic.ts）
npm run check:games                   # 3. 清单：id/no 一致 + 产物 chunk 存在
npm run build                         # 4. 构建（会顺带跑 typecheck）
```

> `check:games` 只有在 `dist/` 存在时才校验 chunk，所以**先 build 再 check**。

### 4. 同步这几处「写死的数量」

加游戏后必须手动同步的位置（都是硬编码的，不会自动跟随）：

| 文件 | 改什么 |
|---|---|
| `index.html` | description 里的「N 款」、`statSoon` 初值、`catalogCount` 的 `/ N OPEN`、`BUILD XXX` |
| `standalone/index.html` | `statSoon`、`catalogCount`（离线单文件版是独立入口） |
| `play/index.html` + `standalone/index.html` | 机台型号 `PA-<N>` |
| `scripts/smoke.mjs` | `ALL` 数组（首页卡片数断言用它算，别再写魔数） |
| `scripts/ci/verify-live.mjs` | `GAMES` 数组 + 首页 `>= N` / `< N` 阈值 |
| `bundle-budget.json` | 见下一节 |
| `docs/game-specs*.md`、`README.md` | 游戏表格 |

### 5. 锁文件（这条坑过一次 CI）

**新增 workspace 包后，必须在所有包都建完后运行一次**：

```bash
npm install --package-lock-only
```

自检（两个数字必须相等）：

```bash
grep -c '"games/[a-z]*": {' package-lock.json   # 锁文件里登记的
ls -d games/*/ | wc -l                          # 实际目录数
```

**为什么重要**：CI 每个 job 都跑 `npm ci`，锁文件缺包会让**所有** job 失败，
连带两个部署 workflow 被跳过。曾经因为分批加包、中途生成了锁文件，最后 4 个包
没进锁文件，推上去 CI 全红，只能追加一个 `fix(ci)` 提交。

---

## 三、游戏契约要点（`docs/GAME_API.md` 的执行摘要）

### GameMeta 硬性要求

- `id` 必须等于目录名，`no` 必须等于 `slots.json` 里的机位号。
- `size`：逻辑分辨率。**宽度统一 168，高度只用 168 或 210**
  （这两档走已调好的宽屏/高屏机台 CSS 路径；`blocks` 的 200×392 是特例，
  由 `.cabinet[data-ratio="tall"]` 单独适配）。
- `hud`：**1–3 栏**，多了布局会坏。
- `pad`：不写就没有虚拟手柄。触屏玩家的唯一操作入口就是它 —— 除非游戏是纯点击，
  **否则必须写 `pad`**。
- `drawThumb(ctx, w, h, t)`：80×50 逻辑像素，必须复用 `art.ts`，且只用 `P.*` 调色板。

### 生命周期

`create()` → `start()` → 每帧 `update(dt)/render()` → `ctx.end()` 一次 → 壳层结算。

- **`ctx.end()` 只能调一次**，调用后壳层停止循环。用 `phase === "over"` 之类的
  守卫防止重复结算。
- **不要自己写最高分**（`store.setBest`）—— 壳层按 `scoreMode` 统一写入。
- 不要操作 `#overlay`、`#hud`、`#toast`、`#field` 的 DOM 结构。

### 计分模式

- `scoreMode: "high"`（默认）：越大越好。
- `scoreMode: "low"`：越小越好（用时/步数），配 `scoreLabel` / `bestLabel`。

### 像素字字符集（容易踩）

HUD 用的像素字库**只支持** `0-9 A-Z + - ! ? % : . / *` 和空格。
**中文会渲染成 `?`**。中文只能放在 `label` / `title` / `toast` / 结算文案里。

HUD 数值要 clamp 到位数，否则会撑破布局。

### 输入

- 指针坐标已经是逻辑像素，直接用。
- 键盘动作名由壳层统一绑定：`left/right/up/down`、`action`、`primary/secondary`、`slot1..9`。
- 空格默认是暂停；要拿空格做操作就在 meta 写 `spaceAction: "action"`。
- **触屏和键盘必须都能玩**，这是质量门槛。

### 绘图与音效红线

- ❌ 不要用 `ctx.fillText` / `ctx.font` / 外部图片 / 外部字体 / 网络请求。
- ✅ 只用 `@arcade/core` 的像素原语：`rect / bevel / line / fillCircle / strokeRect /
  sparkle / drawPixelText / measurePixelText`。
- ✅ 颜色只从 `P.*`（调色板）取，保证 Canvas 与 DOM 同一套色。
- ⚠️ 单帧内不要创建 canvas。静态背景用 `document.createElement("canvas")` 缓存一次。

### 音效

全部 WebAudio 现场合成，无素材文件：
`coin / pop / blip / hit(combo) / gold / miss / spawn / tick / go / end / tier / win / lose / error / slide / ui`，
或 `tone(freq, dur, type, vol, slideTo, delay)`、`noise(...)`。

---

## 四、质量门槛（每款游戏必须全过）

1. `npx tsc -p tsconfig.json --noEmit` 自己的文件零错误。
2. 触屏（pointer）可玩，键盘有等价操作。
3. 准备 → 开始 → 暂停 → 恢复 → 结算 → 再来一局 全流程闭环。
4. 结算只调一次 `ctx.end()`；最高分显示正确。
5. 单帧内不创建 canvas；除 `localStorage` 外无持久化。
6. 无外部资源（图片/字体/音频/网络）。
7. 缩略图与画面同一套调色板。
8. 逻辑尺寸固定，任何窗口下不糊不拉伸。
9. `test/<id>.test.ts` 至少 12 条，**只测 `logic.ts`**（不 import DOM/canvas）。

---

## 五、体积预算

[`bundle-budget.json`](bundle-budget.json) 是硬上限，`npm run ci:bundle` 超了就失败：

| 指标 | 当前阈值 | 实测（30 款） |
|---|---|---|
| JS (gzip) | ≤ 200 KB | 178 KB |
| CSS (gzip) | ≤ 22 KB | 11.9 KB |
| 全部产物 | ≤ 520 KB | 462.4 KB |
| 单文件离线版 | ≤ 500 KB | 427 KB |
| 游戏独立 chunk | ≥ 30 个 | 30 个 |

单款游戏平均约 5–6 KB raw。加游戏后按比例上调 `gameChunksMin` 与其它阈值，
但**不要把阈值一次性拉到很高**——它存在就是为了拦住误引入大依赖。

## 六、命令速查

```bash
npm install              # 装依赖（worktree 里第一次需要）
npm run dev              # http://localhost:5173
npm run typecheck        # tsc --noEmit
npm test                 # vitest 全量（当前 835 条）
npm run build            # typecheck + vite build + 预压缩 → dist/
npm run build:all        # 上面 + 离线单文件版 → dist-standalone/
npm run check:games      # 机位清单 + 产物 chunk 校验
npm run smoke            # 无头 Chrome 冒烟（需先 build + preview）
npm run ci:bundle        # 体积预算
```

冒烟测试需要本机 Chrome；路径由 [`scripts/lib/find-chrome.mjs`](scripts/lib/find-chrome.mjs)
解析（本机为 `D:\ruanjian\Chrome\Application\chrome.exe`），可用 `CHROME_PATH` 覆盖。

```bash
npm run preview                  # 终端 A：http://localhost:4173
node scripts/smoke.mjs           # 终端 B：全部 30 款
node scripts/smoke.mjs whack     # 只跑指定几款
```

产物写到 `.artifacts/smoke/`（截图 + `report.json`），已被 gitignore。

## 七、并行开发约定

本仓结构天然适合并行：**每款游戏是独立目录，写作用域不重叠**。

- 多个子代理并行开发时，各自只碰 `games/<自己的 id>/`。
- **共享文件由主 agent 独自维护**：`slots.json`、`bundle-budget.json`、`index.html`、
  `standalone/index.html`、`play/index.html`、`scripts/smoke.mjs`、
  `scripts/ci/verify-live.mjs`、`docs/`、`README.md`、`package-lock.json`。
- **子代理禁止跑 `npm run build`**（多任务并行时抢 `dist/`），只跑
  `npx tsc --noEmit` 和 `npx vitest run games/<id>`；构建由主 agent 串行执行。
- 任务结束前删除所有临时脚手架（`*.tmp.test.ts`、`*_tmp_*`、`diag*`、
  **`.agent-tmp-*/` 目录**）。清理要在**主检出**和**所有 worktree** 各查一遍：
  VOL.03 收尾时主检出的工作区里就残留了一个 `.agent-tmp-asteroid/`，
  因为任务只交代了「删临时测试文件」，没覆盖到临时**目录**。

## 八、已知的特例与踩坑记录

- **`blocks` 是唯一的宽高比特例**（200×392），靠 CSS 的 `data-ratio="tall"` 适配。
  新游戏不要用这个尺寸，否则要另加 CSS。
- **`dist/` 与 `dist-standalone/` 都被 gitignore**，别提交产物。
- **验证编码**：子代理用 PowerShell 写中文可能产生非法 UTF-8，`tsc`/`vitest`
  都不会报错。合并前跑一次严格 UTF-8 校验（脚本见全局 `~/.dsh/AGENTS.md` 第四节）。
- **`hoop` 有意偏离规格**：`GRAVITY=640` 而非文档写的 900。按 900 计算，
  只有力度 ≥ 0.97 才可能进筐（97% 的力度条是空气球），已用测试钉住命中窗口
  0.60–0.71。改这个值前先看 `games/hoop/src/logic.ts` 的注释。
- **`pong` 的 `logic.ts` 注释曾经损坏过**，已修复；若再次出现非法 UTF-8，
  按全局准则第四节的方法处理（剥注释比对代码，证明只改注释）。

### VOL.03 的已知偏离（都是规格自身矛盾，子代理独立发现后由主 agent 复核批准）

- **`bubble` 蜂窝水平居中**：规格 `x = 8 + col*16 + (row%2)*8` 是按 136 宽推的，
  画布固定 168 时照抄会让右边留 40px，炮台移到 x=160 就完全落空。
  已改为 `ORIGIN_X = 28` 居中，行高 / 列距 / 奇偶偏移保持原值，并用单测钉住左右留白对称。
- **`maze` 的 `ORIGIN` 是 (6, 15)**：同一节同时要求「棋盘 156×180」与「垂直居中」，
  高 210 时居中偏移只能是 `(210-180)/2 = 15`，规格写 (6,6) 是笔误。
- **`pipe` 只打乱内部格、边界格保持正确朝向**：规格允许死路，但死路永远无法注满，
  会让「100% 注水通关」这个胜利条件**永不可达**。实测按规格打乱边界，
  60 关里只有 3 关可解。现在保证任何旋转中间态都不漏水，120 关全部可解，
  最优解 36–73 步（上限 80）。
- **`pipe` 用汉密尔顿一笔画生成通道**（而非 DFS + 随机填充），理由同上条：
  DFS 必然留下永远注不满的死格。
- **`asteroid` 的 `shipVelocity` 多一个可选参数 `current`**：规格要求「不推进时保持原速」，
  但原签名无法表达当前速度，二者必须同时成立。旧调用完全兼容。
- **`lander` 燃料每段下降重置**：规格只说「燃料 100」，未定义单局是单次还是多次下降。
  做成多段连打，燃料加成衡量每段效率。
- **`frog` 上下跳跃保持当前 x**（不吸附格心），否则河面踩浮木没有连续手感。
- **`rhythm` 方向键→轨道映射**：规格只说"对应 0/1/2/3"，实现取
  left=0 / down=1 / up=2 / right=3（d-pad 物理左到右）。

**`pinball` 的物理常量已由主 agent 预先仿真，不要改**：`GRAVITY = 150` 让自由落体末速
（251px/s）刚好低于速度上限（260），球不会长期贴上限；`SUB_STEP_MS = 4` 让满速单子步
位移 1.04px < 球半径 4px，用整帧 50ms 不分子步会位移 13px 直接穿过 5px 挡板。
挡板必须按**线段**做点—线段最近点碰撞，不是圆。
