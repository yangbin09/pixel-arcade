# 第三辑 · 十款新游戏实现规格（机位 21–30）

> **先读 [`docs/game-dev-card.md`](game-dev-card.md)**（速查卡，约 130 行）。
> 完整契约 [`docs/GAME_API.md`](GAME_API.md) 不必通读，遇到卡片没覆盖的再查。
> 参考实现只看 1 个：`games/mines/`（网格+光标）、`games/whack/`（反应类）。
> 每个游戏只在自己的目录里写文件；`packages/` 一律不要改。

## 通用要求（每个游戏都适用）

- 文件：`games/<id>/{package.json, src/meta.ts, src/index.ts, src/logic.ts, src/art.ts, test/<id>.test.ts}`
- `package.json` 照抄 `games/mines/package.json`，只把名字换成 `@arcade/game-<id>`。
- `src/logic.ts` 是**纯函数 + 可注入随机源**，不 import DOM、不调 `Math.random()`。
- `src/index.ts` 用 `defineGame({ meta, create })`，只写 `start/update/render/pause/resume/destroy`。
- **`dt` 是毫秒**。所有物理常量按「px 每秒」写，用 `dt / 1000` 换算。这是最容易错的地方。
- `src/art.ts` 放像素素材，`meta.ts` 的 `drawThumb` 必须复用它们。
- 单测 `test/<id>.test.ts` 只测 `logic.ts`（node 环境），**≥12 条 `it()`**。
- 结算只调一次 `ctx.end()`；最高分由壳层写，不要自己 `setBest`。
- 触屏 + 键盘两条通路都必须有。除纯点击类，`meta.pad` 必须写。
- 逻辑尺寸：`w` 固定 **168**，`h` 只用 **168** 或 **210**。

## 像素字字符集

`0-9 A-Z + - ! ? % : . / *` 和空格。中文只能出现在 `label` / `toast` / 结算文案。

---

## 21. frog · 青蛙过河

- `size: { w: 168, h: 210 }`，`scoreMode: "high"`
- HUD：`score`（分数，pad 5，tone score）、`row`（最远行，2 位，tone mint）、`lives`（命，1 位，tone red）
- 文案：tagline `跳过车道，踩准浮木`；duration `1–3 分钟`
- tags：`每前进一行 +10`、`三条命`、`落水即扣命`
- `pad: { dpad: "four", a: { action: "action", label: "跳" } }`
- `start` 不显示额外倒计时（用壳层默认）

### 网格

- 11 行 × 8 列，格子 **20×18**，格心 `cellCenter(col, row) = { x: 10 + col*20, y: 198 - row*18 }`。
- 行 0 是起点岸（草），行 10 是终点岸（草）；行 1–5 是**车道**，行 6–9 是**河**。
- 青蛙初始 `row = 0, col = 4`。

### 车道（行 1–5）

- 每行一条传送带，车从左或从右驶过。`carLane(row)` 返回 `{ dir: 1 | -1, speed: number, gap: number }`。
- 速度：`80 + row * 22` px/s（行 1 = 102，行 5 = 190）。
- 间距：`gap = 66 - row * 4` px（行 1 = 62，行 5 = 46）。
- 车宽 16、高 12；被车撞到 = **扣一条命**，青蛙回到起点岸（不是游戏结束）。

### 河（行 6–9）

- 每行一块浮木带，`logLane(row)`：速度 `60 + (row - 6) * 18` px/s，方向交替（行 6 向右、行 7 向左、行 8 向右、行 9 向左）。
- 浮木宽 **28**、高 16，间距 **40**。
- 站在浮木上会被带着横向移动；**横向超出 168 的画布边界即落水**。
- 落水 = 扣一条命 + 回到起点岸。

### 规则

- 一次跳跃移动一格（上下左右）。键盘在**按下瞬间**跳跃（不要做成持续移动）。
- 每次前进到**新的最远行**时 +10 分（同一行反复走不重复加分）。
- 到达行 10 = 通关，`ctx.end()`，分数额外 +50。
- 三条命用完 = 结束。
- 计时器：每局 **60 秒**，用 `ctx.timer.set()`。

### logic.ts 必须导出

```ts
CELL_W, CELL_H, COLS, ROWS, START_ROW, GOAL_ROW, RIVER_FROM, LIVES
cellCenter(col, row): { x: number; y: number }
carLane(row): { dir: 1 | -1; speed: number; gap: number } | null
logLane(row): { dir: 1 | -1; speed: number; gap: number } | null
movePlayer(pos, dir): { col: number; row: number }      // 夹在 [0,COLS-1] / [0,ROWS-1]
advanceScore(prevBestRow, newRow): number               // 只在前进时给分
isOnLog(playerX, logs): boolean
```

### 单测重点

行范围、`cellCenter` 边界、`movePlayer` 夹取、`advanceScore` 只对前进给分（同行/后退给 0）、车道速度单调、`isOnLog` 落在浮木上/间隙里。

---

## 22. bubble · 泡泡龙

- `size: { w: 168, h: 210 }`，`scoreMode: "high"`
- HUD：`score`（pad 5，tone score）、`shots`（剩余弹数，2 位，tone mint）、`next`（下颗颜色，text，tone gold）
- 文案：tagline `同色三连，整串掉落`；duration `2–5 分钟`
- tags：`同色 ≥3 消除`、`断连整串掉落`、`弹数有限`
- `pad: { dpad: "lr", a: { action: "action", label: "发弹" }, b: { action: "secondary", label: "换色" } }`

### 蜂窝网格

- 泡泡半径 **8**，直径 16。行高 `rowHeight = 13.86`（= `16 * sqrt(3)/2`，取 `13.86`）。
- 偶数行 8 列，奇数行 **7 列**，奇数行整体右移 8px（半个直径）。
- `hexCenter(col, row)`：
  ```ts
  x = 8 + col * 16 + (row % 2) * 8
  y = 8 + row * 13.86
  ```
- `hexNeighbors(col, row)` 返回存在的相邻格（偶数行与奇数行的邻居偏移**不同**）：
  - 偶数行：`(-1,0) (+1,0) (0,-1) (-1,-1) (0,+1) (-1,+1)`
  - 奇数行：`(-1,0) (+1,0) (+1,-1) (0,-1) (+1,+1) (0,+1)`

### 规则

- 网格预填 **5 行**，颜色从 `PALETTE` 的 4 色集合里随机（随机源注入）。
- 发射：底部的炮台 `cannonX` 由左右键 / 拖拽控制，`clamp(8, 160)`。发射角固定竖直向上，遇到左右墙按 `reflectAngle(vx)` 反弹。
- 球速 **220** px/s，每 **4ms** 一个子步防止穿透（同机位 29 的做法）。
- 落位：碰到已有泡泡或顶部后吸附到最近的空格。
- 消除：落位后若同色连通块 `>= 3`，整块消除，`+20 * n` 分。
- 掉落：消除后**不与顶部连通**的泡泡整串掉落，每颗 `+10`。
- 弹数 **40**，用完即结束；清空全场提前结束并 `+200`。

### logic.ts 必须导出

```ts
RADIUS, ROW_H, COLS_EVEN, COLS_ODD, ROWS_MAX, SHOTS
hexCenter(col, row): { x: number; y: number }
hexNeighbors(col, row): { col: number; row: number }[]
reflectAngle(vx, x): number            // 撞左/右墙后 vx 取反
snapToGrid(x, y): { col: number; row: number }
sameColorCluster(grid, col, row): { col: number; row: number }[]
detachedFromCeiling(grid): { col: number; row: number }[]
scoreForClear(n): number                // 20 * n
```

### 单测重点

`hexCenter` 奇偶行偏移正确、`hexNeighbors` 六邻且边界过滤、`snapToGrid` 贴到不重叠格、`sameColorCluster` 只连同色、`detachedFromCeiling` 顶部行永不掉落、`scoreForClear` 线性。

---

## 23. rhythm · 四轨节拍

- `size: { w: 168, h: 168 }`，`scoreMode: "high"`，`spaceAction: "action"`（空格也发弹）
- HUD：`score`（pad 5，tone score）、`combo`（连击，3 位，tone combo）、`acc`（准确率，text，tone mint）
- 文案：tagline `四条轨道，踩准每一拍`；duration `1–2 分钟`
- tags：`PERFECT ±45ms`、`连击加成`、`BPM 递增`
- `pad: { dpad: "four", a: { action: "action", label: "击打" }, b: { action: "secondary", label: "击打" } }`
  - 四个方向键分别对应四条轨道 0/1/2/3；A 与 B 是备用击打键（打当前最近的那个）。

### 时钟（关键：必须用帧时钟，不能用 `performance.now`）

- 谱面时间 `songTime` 每帧 `songTime += dt`（毫秒）。**禁止**用真实时钟差值判定，
  否则暂停/恢复会让谱面与时钟错位。
- 轨道 x 坐标：`laneX(i) = 21 + i * 42`（i = 0..3，即 21 / 63 / 105 / 147）。
- 判定线 `HIT_Y = 140`，音符从 `y = -12` 下落。

### 判定窗口

| 判定 | 窗口 | 分数 |
|---|---|---|
| PERFECT | `|Δ| <= 45ms` | `100 * (1 + combo/50)` |
| GOOD | `45 < |Δ| <= 90ms` | `50 * (1 + combo/50)` |
| MISS | `> 90ms` 或漏过 | 0，连击清零 |

- `judge(deltaMs)` 是纯函数，返回 `"perfect" | "good" | "miss"`，**必须**单测三个边界。
- `hitScore(judge, combo)` 也是纯函数。

### 谱面

- `bpmAt(progress)`：`progress` 是 0..1 的曲目进度。BPM 从 **96** 线性升到 **144**。
- 音符间隔 `beatIntervalMs(bpm) = 60000 / bpm / 2`（八分音符）。
- `noteFallMs(bpm)`：音符从生成到判定线的时长，固定 **900ms**（不随 BPM 变，保证可读）。
- 掉落速度 = `(HIT_Y + 12) / 900 * 1000` px/s ≈ 169 px/s。

### 规则

- 曲目 **75 秒**。结束时 `ctx.end()`，`acc` = 加权准确率。
- 连击每 10 加一档音效（`ctx.audio.hit(combo)`）。

### logic.ts 必须导出

```ts
LANES, HIT_Y, PERFECT_MS, GOOD_MS, SONG_MS
laneX(i): number
bpmAt(progress): number
beatIntervalMs(bpm): number
judge(deltaMs): "perfect" | "good" | "miss"
hitScore(kind, combo): number
accuracy(perfect, good, total): number   // 0..1，total=0 时返回 1
```

### 单测重点

`judge` 四端（-91 / -90 / -46 / -45 / 0 / 45 / 46 / 90 / 91）、`bpmAt` 两端与单调、
`hitScore` 连击加成、`accuracy` 分母为 0、`beatIntervalMs` 与 BPM 反比。

---

## 24. asteroid · 环形陨石带

- `size: { w: 168, h: 210 }`，`scoreMode: "high"`
- HUD：`score`（pad 5，tone score）、`lives`（1 位，tone red）、`wave`（波次，2 位，tone mint）
- 文案：tagline `惯性漂流，转着打`；duration `2–4 分钟`
- tags：`陨石会分裂`、`无摩擦惯性`、`屏幕环绕`
- `pad: { dpad: "lr", a: { action: "action", label: "开火" }, b: { action: "secondary", label: "推进" } }`

> 与 `invaders` 的区别：**本作是惯性飞船 + 360° 旋转 + 屏幕环绕 + 陨石分裂**，
> 不是编队下压。不要让玩法趋同 `invaders`。

### 物理

- 飞船朝向 `angle`（弧度），左右键以 **3.6 rad/s** 转向。
- 推进：按住 B，加速度 **110** px/s²（沿朝向）。**无摩擦**，速度上限 **160** px/s。
- 松手不减速——这是「惯性漂流」的核心手感，不要加阻尼。
- 屏幕环绕：任何物体出界后从对面回来（`wrapX/wrapY`）。
- 子弹：速度 **240** px/s + 飞船速度矢量的一半，冷却 **180ms**，存活 **700ms**。

### 陨石

- 三档大小：`large`（半径 16，分裂 2 个 medium）、`medium`（10，分裂 2 个 small）、`small`（6，不分裂）。
- 得分：`large` 20、`medium` 50、`small` 100。
- 每波 `6 + wave` 颗，波次间隔 **1.6 秒**。
- 陨石速度 `36 + wave * 6`，上限 **90** px/s。

### 规则

- 3 条命，被陨石撞到扣命 + 无敌 **1.2 秒**。
- 清完一波进下一波。

### logic.ts 必须导出

```ts
TURN_RATE, THRUST, MAX_SHIP_SPEED, BULLET_SPEED, BULLET_MS, FIRE_COOLDOWN_MS, INVULN_MS
wrapX(x): number
wrapY(y): number
shipVelocity(angle, thrusting, dtMs): { vx: number; vy: number }   // 累加后再 clamp
splitAsteroid(size): "medium" | "small" | null
scoreForSize(size): number
spawnCount(wave): number
asteroidSpeed(wave): number
```

### 单测重点

`wrapX` 出界环绕（含负值）、`splitAsteroid` 三档、`scoreForSize` 越打越大、
`asteroidSpeed` 上限、`shipVelocity` 不推进时保持原速（惯性）、速度上限夹取。

---

## 25. lander · 月面着陆

- `size: { w: 168, h: 210 }`，`scoreMode: "high"`
- HUD：`score`（pad 5，tone score）、`fuel`（燃料 0–100，3 位，tone gold）、`alt`（高度米，3 位，tone mint）
- 文案：tagline `一个喷嘴，稳着落`；duration `30 秒–2 分钟`
- tags：`剩余燃料加分`、`倾斜过大即坠毁`、`软着陆有奖`
- `pad: { dpad: "lr", a: { action: "action", label: "推进" } }`

### 物理（按 px 每秒的常量）

- 重力 **90** px/s²（月面感，比地球小）。
- 喷嘴沿飞船**正上方**推力 **170** px/s²（按住 A）。
- 左右键以 **1.8 rad/s** 旋转飞船。
- 燃料：**100** 单位，推进时每 **1** 单位 / **80ms**。燃料耗尽推力失效但仍受重力。
- 初速度：`vy = 20`，`vx` 随机在 `[-14, 14]`（随机源注入）。
- 起始高度 `y = 30`，地面 `GROUND_Y = 190`。

### 着陆判定（`landingResult`）

```ts
type Verdict = "perfect" | "good" | "rough" | "crash";
```

| 条件 | 判定 |
|---|---|
| `\|vy\| <= 32` 且 `\|angle\| <= 0.10 rad` | `perfect` |
| `\|vy\| <= 58` 且 `\|angle\| <= 0.22 rad` | `good` |
| `\|vy\| <= 92` 且 `\|angle\| <= 0.42 rad` | `rough` |
| 其它（含撞到岩石） | `crash` |

- 只有 `perfect` / `good` 算成功着陆，结算给分。
- 得分：`base = 300/200/100`（perfect/good/rough）+ `fuel * 4` + `max(0, 200 - 水平漂移*2)`。

### 地形

- 每局程序生成一条着陆带：平坦区宽度 **>= 34px** 才算有效着陆点，
  两侧是岩石（撞上即 `crash`）。随机源注入，同种子必须同地形。

### logic.ts 必须导出

```ts
GRAVITY, THRUST, TURN_RATE, FUEL_MAX, FUEL_BURN_MS, GROUND_Y, START_Y
landingResult(vy, angle, onRock): Verdict
landingScore(verdict, fuel, driftX): number
burnFuel(fuel, thrusting, dtMs): number
terrainFor(rand): { pads: { x: number; w: number }[]; rocks: { x: number; w: number }[] }
isOnPad(x, pads): boolean
```

### 单测重点

`landingResult` 四档边界（速度与角度各自越界）、`landingScore` 燃料加成单调、
`burnFuel` 不推进不掉油且夹在 0、`terrainFor` 同种子同地形且着陆带 >= 34px、
`isOnPad` 落点判定。

---

## 26. gomoku · 十三路五子棋

- `size: { w: 168, h: 168 }`，`scoreMode: "high"`
- HUD：`score`（pad 5，tone score）、`win`（胜局，1 位，tone mint）、`lose`（负局，1 位，tone red）
- 文案：tagline `十三路连五，三局定输赢`；duration `2–5 分钟`
- tags：`连五即胜`、`AI 会堵活三`、`三局两胜`
- `pad: { dpad: "four", a: { action: "primary", label: "落子" }, b: { action: "secondary", label: "悔棋" } }`

### 棋盘

- **13×13**，格子 **12px**，棋盘 **156×156**，原点 `(6, 6)`。
- `cellCenter(col, row) = { x: 6 + col*12 + 6, y: 6 + row*12 + 6 }`。
- `indexToCell(i)` / `cellToIndex(col, row)` 互逆。

### 胜负判定

- 任意方向（横、竖、两条斜线）连续 **5 子**即胜。`checkWin(board, index)` 只看落子点所在四条线。
- `legalMoves(board)` 返回全部空点；**必胜/必堵**由 `bestMove` 处理。
- 三局两胜：先赢两局者结束；平局（棋盘下满）不计分。

### AI（必须可被击败）

`bestMove(board, ai, rand)` 优先级：

1. 自己能连五 → 直接下（赢）。
2. 对手下一步能连五 → 堵（如果有多处，选评分最高的一处）。
3. 自己活四 / 对手活四 → 相应进攻或防守。
4. 否则用**评分函数** `scoreCell(board, index, who)`：
   每个方向统计以该点为轴的连子数，给出 `10^连子数` 量级的分数，
   在每个候选点周围 **2 格**范围内取最高分，平手随机（注入 `rand`）。

- **硬性要求**：写一条测试，用一个简单的贪心人类策略跑 40 局，断言人类至少赢 **5** 局。
  如果 AI 全胜，说明评分函数过强，必须调弱（降低深度或引入随机扰动）。

### logic.ts 必须导出

```ts
SIZE, WIN_LEN, CELL, ORIGIN
emptyBoard(): number[]                  // 0 = 空, 1 = 黑(玩家), 2 = 白(AI)
cellCenter(col, row): { x: number; y: number }
cellToIndex(col, row): number
indexToCell(index): { col: number; row: number }
legalMoves(board): number[]
checkWin(board, index): 0 | 1 | 2       // 返回赢家，无人赢返回 0
bestMove(board, ai, rand): number
scoreCell(board, index, who): number
```

### 单测重点

13×13 常量、`indexToCell` 与 `cellToIndex` 互逆、横/竖/斜三种连五各一条、
四子不算胜、`legalMoves` 排除已占点、`bestMove` 在「自己能连五」时直接取胜、
`bestMove` 在「对手要连五」时必堵。

---

## 27. navy · 海战棋

- `size: { w: 168, h: 168 }`，`scoreMode: "high"`
- HUD：`score`（pad 5，tone score）、`hits`（命中数，2 位，tone mint）、`left`（敌剩余格，2 位，tone red）
- 文案：tagline `布好舰队，交替炮击`；duration `2–5 分钟`
- tags：`五艘舰队`、`命中再打一次`、`AI 会追残舰`
- `pad: { dpad: "four", a: { action: "primary", label: "炮击" }, b: { action: "secondary", label: "随机" } }`

### 棋盘与舰队

- 双方各一张 **8×8** 棋盘（"your" / "enemy"），共 64 格。
- 舰队（长度）：**5, 4, 3, 3, 2**（合计 17 格）。
- 布阵：`placeFleet(rand)` 随机放置，**不允许重叠、不允许贴边相邻**（对角相邻允许）。
  同种子必须同布阵。
- 舰船用 `{ cells: number[]; hits: Set<number> }` 表示，`isSunk(ship)` = 全部命中。

### 炮击

- 玩家先手，轮流炮击。命中 → **再打一次**；未命中 → 换手。
- `resolveShot(board, index)` 返回 `{ hit: boolean; sunk: ship | null; already: boolean }`。
- 命中敌舰 `+1` 分；击沉额外 `+10`；全歼 `+100` 并结束。

### AI（必须可被击败）

- 维护 `remaining: number[]` 候选格与 `hitStack`：命中后把该点四邻加入优先队列（追残舰）。
- 队列空时按**概率网格**选：对每艘未沉舰长的所有可能摆放位置计数，
  取覆盖次数最高的格（`probabilityGrid`）。
- 平手随机（注入 `rand`）。允许 AI 有 **30%** 概率退回纯随机，避免过强。

### logic.ts 必须导出

```ts
SIZE, FLEET, TOTAL_SHIP_CELLS
emptyBoard(): number[]
placeFleet(rand): Ship[]
cellToIndex / indexToCell
resolveShot(board, ships, index): { hit: boolean; sunk: number | null; already: boolean }
isSunk(ship): boolean
probabilityGrid(board, ships): number[]      // 64 个权重
pickShot(board, ships, hitStack, rand): number
allSunk(ships): boolean
```

### 单测重点

舰队总格数 17、`placeFleet` 同种子同布阵且不重叠、`isSunk` 全中才沉、
`resolveShot` 重复炮击返回 `already`、`allSunk` 全沉才 true、
`probabilityGrid` 未沉舰权重为正且长度 64。

---

## 28. maze · 迷雾迷宫

- `size: { w: 168, h: 210 }`，`scoreMode: "low"`（用时越低越好）
- HUD：`time`（用时，`kind: "time"`，tone time）、`keys`（钥匙 `k/n`，text，tone gold）、`seen`（已探索 %，3 位，tone mint）
- 文案：tagline `摸黑前行，找齐钥匙`；duration `1–4 分钟`
- tags：`视野只有 3 格`、`找齐 3 把钥匙`、`用时越短越好`
- `pad: { dpad: "four", a: { action: "primary", label: "标记" } }`
- `scoreLabel: "用时（秒）"`，`bestLabel: "最快纪录"`，`countdown: false`

### 迷宫

- 逻辑格子 **13×15**，格 **12px**，原点 `(6, 6)`，实际像素 **156×180**，垂直居中。
- 程序生成：`generateMaze(cols, rows, rand)` 用**深度优先回溯**，
  起点固定左上 `(1,1)`（奇数列/行），出口在右下。
- 同种子必须生成同一迷宫（**必须单测**）。

### 迷雾

- 视野半径 **3 格**（切比雪夫距离 `<= 3`），且**不穿墙**——
  `visibleCells(maze, from)` 用 BFS 沿走廊扩散，遇到墙停止。
- 玩家走过的格子永久可见（`explored` 集合）。

### 规则

- 3 把钥匙随机放在**非起点、非出口**的走廊格上。
- 沿走廊移动一格用 **180ms** 平滑插值（不是瞬移），按住方向键连续走。
- 撞墙不动。
- 找齐 3 把钥匙后出口激活，进入即结束。`score = ceil(elapsed/1000)`。

### logic.ts 必须导出

```ts
COLS, ROWS, CELL, ORIGIN, VIEW_RADIUS, KEYS
generateMaze(cols, rows, rand): Uint8Array      // 1 = 墙, 0 = 走廊
cellToIndex(col, row): number
indexToCell(index): { col: number; row: number }
isWall(maze, col, row): boolean
canWalk(maze, from, to): boolean               // 只允许相邻且都不是墙
visibleCells(maze, from): number[]             // BFS，半径 3，不穿墙
placeKeys(maze, rand, count): number[]
exploredPercent(explored, walkable): number    // 0..100
```

### 单测重点

`generateMaze` 同种子同迷宫、起点与出口必通路（BFS 可达）、`canWalk` 拒绝斜走与穿墙、
`visibleCells` 不超半径且不穿墙、`placeKeys` 不落在起点/出口、`exploredPercent` 边界（0 与 100）。

---

## 29. pinball · 弹珠台

> **这是本辑风险最高的游戏**。物理常量已由主 agent 预先仿真验证（见下），
> **不要自行改动数值**；若确需调整，必须先按「验证方法」重跑一遍再向你报告。

- `size: { w: 168, h: 210 }`，`scoreMode: "high"`
- HUD：`score`（pad 5，tone score）、`balls`（剩余球，1 位，tone red）、`mult`（倍率 `x2`，text，tone gold）
- 文案：tagline `守住底门，打满缓冲器`；duration `1–3 分钟`
- tags：`缓冲器 +100`、`连击加倍率`、`掉球扣命`
- `pad: { dpad: "lr", a: { action: "primary", label: "左板" }, b: { action: "secondary", label: "右板" } }`

### 已验证的物理常量（**不要改**）

```ts
GRAVITY = 150          // px/s²   ← 仿真：跨台自由落体 251px/s，略低于速度上限
MAX_BALL_SPEED = 260   // px/s    ← 上限夹取，防止缓冲器无限加速
BALL_R = 4             // px
SUB_STEP_MS = 4        // 固定子步：4ms。整帧 50ms 不做子步会位移 13px → 穿透挡板
WALL_RESTITUTION = 0.92
BUMPER_RESTITUTION = 1.02   // 略大于 1 才有「弹开」感，靠 MAX_BALL_SPEED 收敛
BUMPERS = [{ x: 40, y: 72, r: 10 }, { x: 128, y: 72, r: 10 }, { x: 84, y: 116, r: 10 }]
FLIP_LEN = 34, FLIP_Y = 186, FLIP_XL = 30, FLIP_XR = 138
FLIP_FROM = 28° (deg), FLIP_TO = -24°, FLIP_MS = 90
```

**为什么 `GRAVITY = 150`**：仿真的三档候选里，`150` 让自由落体末速（251px/s）刚好低于
速度上限（260），球不会长期贴着上限飞；`220` 会给 304px/s，全程被夹住，手感变钝。

**为什么必须 4ms 子步**：满速下单子步位移 1.04px < 球半径 4px；
若用整帧 50ms 不分子步，位移 13px，会直接穿过 5px 厚的挡板。

### 挡板

- 左右各一块，绕根部旋转。按住 A/B 时在 **90ms** 内从 `FLIP_FROM` 转到 `FLIP_TO`，
  松手在 90ms 内转回。
- 挡板尖端速度约 **343 px/s**，是球速上限的 1.32 倍——**这就是能打出力度的来源**。
- 挡板碰撞：把挡板当作**线段**做「点—线段最近点」检测（不要当圆），
  命中后沿法线反射并乘以 **0.95**。

### 规则

- 3 颗球。球掉出底部（`y > H`）扣一命，重新从顶部投入。
- 缓冲器撞击 `+100`，连续（间隔 < 900ms）依次 `+100 / +200 / +400`，倍率最高 `x8`。
- 靶标（两侧各 3 个）：打亮 6 个 `+1000` 并重置。
- 球全部用完结束。

### logic.ts 必须导出

```ts
GRAVITY, MAX_BALL_SPEED, BALL_R, SUB_STEP_MS, WALL_RESTITUTION, BUMPER_RESTITUTION
BUMPERS, FLIP_LEN, FLIP_Y, FLIP_XL, FLIP_XR, FLIP_FROM, FLIP_TO, FLIP_MS
clampSpeed(vx, vy): { vx: number; vy: number }
stepBall(ball, dtMs, flippers): Ball          // 内部按 SUB_STEP_MS 分子步
flipperSegment(side, angleDeg): { x0: number; y0: number; x1: number; y1: number }
segmentClosest(px, py, seg): { x: number; y: number; dist: number }
multiplierFor(hits, sinceMs): number          // 1 / 2 / 4 / 8
scoreForBumper(mult): number
isDrained(y): boolean
```

### 单测重点

`clampSpeed` 满速夹取与方向不变、`stepBall` 子步数 `ceil(dt/4)`、
`stepBall` 高速下不穿墙（跑 200 帧断言 y 始终在台内）、
`multiplierFor` 超时回落到 1、`segmentClosest` 端点与垂足、`scoreForBumper` 倍率线性。

### 验证方法（改动常量前必须跑）

```python
# 三个候选重力各跑 60 次 20 秒，断言 maxspeed <= MAX_BALL_SPEED 且 escapes == 0
# 断言满速下单子步位移 < BALL_R：MAX_BALL_SPEED * (SUB_STEP_MS/1000) = 1.04 < 4  ✓
```

**若调不出手感**：降级为纵向 `breakout` 变体（单挡板、砖块阵列、球速 180），
并在提交信息里说明降级原因。

---

## 30. pipe · 接水管

- `size: { w: 168, h: 210 }`，`scoreMode: "low"`（步数越低越好）
- HUD：`moves`（步数，3 位，tone time）、`fill`（注水进度 %，3 位，tone mint）、`leaks`（漏水数，1 位，tone red）
- 文案：tagline `转直管道，把水送到头`；duration `1–3 分钟`
- tags：`每转一次 +1 步`、`中途漏水即失败`、`步数越少越好`
- `pad: { dpad: "four", a: { action: "primary", label: "旋转" }, b: { action: "secondary", label: "提示" } }`
- `scoreLabel: "步数"`，`bestLabel: "最少步数"`，`countdown: false`

### 网格

- **7×9** 格，格 **20px**，原点 `(14, 24)`，实际 **140×180**。
- 每格是一条管道，形状由 `4` 位掩码表示连接方向（上/右/下/左 = 1/2/4/8）：
  - `直管`：上下 `0b0101` 或 左右 `0b1010`
  - `弯管`：四种组合
  - `三通` / `四通` 不放（保持简单）
- 旋转 `rotate(mask)`：`((mask << 1) | (mask >> 3)) & 0b1111`（顺时针）。
- 起点在左上格，水源从左边缘进入；终点在右下格，出口在右边缘。

### 生成

- `generateLevel(cols, rows, rand)`：
  1. 先用 DFS 生成一条从起点到终点的**通路**，沿途放直管/弯管（方向朝向下一点）。
  2. 其余格子随机放直管/弯管，**但这会引入死路**——允许，死路只是不通水的格子。
  3. 记录 `solution` 白盒（每格需要旋转几次才朝向正确）。
- **必须保证可解**：生成后自带校验 `isSolvable(puzzle, solution)`，
  不满足就重来（最多 40 次，仍失败则退回固定布局）。
- 同种子必须生成同一关（**单测**）。

### 注水

- `flowFrom(start, grid)`：从起点 BFS，只沿**两侧都连通**的相邻格扩散。
- 每走一步（玩家旋转一次）重新算一遍 `filled`。
- **漏水判定**：注水推进到某格时，若该格的**已连通方向指向外侧边缘**
  （除起点左边缘与终点右边缘）→ 漏水。漏水数 `+1` 且**立即失败**。
- 全部格子注满 → 通关，`score = moves`。
- 漏水或步数超过 **80** 则结束。

### logic.ts 必须导出

```ts
COLS, ROWS, CELL, ORIGIN, MAX_MOVES
UP, RIGHT, DOWN, LEFT
rotate(mask): number
connects(maskA, maskB): boolean          // A 的右边与 B 的左边是否都连通
generateLevel(cols, rows, rand): { grid: number[]; solution: number[] }
isSolvable(grid, solution): boolean
flowFrom(start, grid): number[]          // 能通水的格子索引
countLeaks(grid, filled): number
filledPercent(filled, total): number
```

### 单测重点

`rotate` 四次回到原值、`connects` 八个方向对、`generateLevel` 同种子同关卡且可解、
`isSolvable` 对已解关卡返回 true、对随机关卡返回 false 的概率 > 0、
`flowFrom` 只沿连通扩散、`countLeaks` 边界之外不误报。

---

## 附录：本辑新增的机位号

| 机位 | id | 标题 | 尺寸 | 计分 |
|---|---|---|---|---|
| 21 | `frog` | 青蛙过河 | 168×210 | high |
| 22 | `bubble` | 泡泡龙 | 168×210 | high |
| 23 | `rhythm` | 四轨节拍 | 168×168 | high |
| 24 | `asteroid` | 环形陨石带 | 168×210 | high |
| 25 | `lander` | 月面着陆 | 168×210 | high |
| 26 | `gomoku` | 十三路五子棋 | 168×168 | high |
| 27 | `navy` | 海战棋 | 168×168 | high |
| 28 | `maze` | 迷雾迷宫 | 168×210 | **low** |
| 29 | `pinball` | 弹珠台 | 168×210 | high |
| 30 | `pipe` | 接水管 | 168×210 | **low** |
