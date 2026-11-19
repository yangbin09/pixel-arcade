# 第二辑 · 十款新游戏实现规格（机位 11–20）

> 先读 `docs/GAME_API.md`，再看 `games/mines/` 与 `games/whack/` 作为参考实现。
> 每个游戏只在自己的目录里写文件；`packages/` 一律不要改。
> 视觉基线：调色板只用 `P.*`，像素字只用 `drawPixelText` / HUD，不允许外部素材与网络请求。
> 逻辑尺寸宽度统一 168，高度只用 **168** 或 **210**（这两档走已调好的宽屏机台路径）。

## 通用要求（每个游戏都适用）

- 文件：`games/<id>/{package.json, src/meta.ts, src/index.ts, src/logic.ts, src/art.ts, test/<id>.test.ts}`
- `package.json` 只有 10 行，照抄 `games/mines/package.json`，把名字换成 `@arcade/game-<id>`。
- `src/logic.ts` 是**纯函数 + 可注入随机源**，不 import DOM、不读 `Math.random()`（随机源由调用方传入，默认 `Math.random`）。
- `src/index.ts` 用 `defineGame({ meta, create })`，只写 `start / update / render / pause / resume / destroy`。
- `src/art.ts` 放像素素材绘制函数，`meta.ts` 的 `drawThumb` 复用它们。
- 单测放 `test/<id>.test.ts`，只测 `logic.ts`（node 环境，无 DOM），**至少 12 条** `it()`。
- 结算只调一次 `ctx.end()`；最高分由壳层写入，游戏不要自己写 `store.setBest`。
- 超出范围的分数/时间要夹住（HUD 是固定位数）。
- 触屏可玩 + 键盘等价的通路都必须存在。

## 像素字的字符集

`0-9 A-Z + - ! ? % : . / *` 和空格。中文只能出现在 `label` / `toast` / 结算文案里。

---

## 11. runner · 像素跑酷

- `size: { w: 168, h: 210 }`，`scoreMode: "high"`，`spaceAction: "action"`
- HUD：`score`（分数，pad 5，tone score）、`dist`（距离米，pad 4，tone mint）、`speed`（速度档，2 位，tone combo）
- 文案：tagline `跳过箱子，滑过横梁`；duration `1–2 分钟`
- tags：`金币 +10`、`每 200 米提速`、`撞到即结束`
- `pad: { a: { action: "action", label: "跳" }, b: { action: "secondary", label: "滑" } }`（不要 dpad）

**规则**

- 地面 y=170，跑道从 x=0 到 168；玩家固定 x=40，脚底贴地。
- 世界向左滚动，`speedAt(dist)`：120px/s 起，每 200 米 +14px/s，上限 300。
- 障碍三种：`box`（矮箱，28×18，必须跳）、`beam`（横梁，贴地向上 34px，必须滑）、`bird`（飞鸟，y 在 110–130 浮动，可跳可滑）。
- 生成间隔 `spawnGap(speed) = clamp(72 - speed*0.12, 44, 72)`（像素换算成米）。
- 跳跃：初速 -270px/s，重力 900px/s²；**按住 A 到顶点可持续加高**（`jumpVelocity(holdMs)`：按住 0ms → -270，按住 180ms 及以上 → -330，线性插值）。
- 滑行：按下 B 持续 420ms，玩家高度从 30 变 16。
- 金币：+10 分，只在障碍之间的安全区生成，且必须落在跳跃可达弧线上。
- 碰撞：AABB；撞到障碍即结束。
- stats：`距离`、`金币`。

**logic.ts 必须导出**

`GRAVITY`, `GROUND_Y`, `PLAYER_X`, `speedAt(dist)`, `jumpVelocity(holdMs)`, `spawnGap(speed)`, `playerBox(y, sliding)`, `obstacleBox(o)`, `overlaps(a, b)`, `addScore(coin)`

**单测重点**：速度上限、蓄力映射两端、碰撞盒随滑行变矮、金币不与障碍重叠、分数累加。

---

## 12. othello · 像素黑白棋

- `size: { w: 168, h: 168 }`，`scoreMode: "high"`
- HUD：`score`（总分，pad 5）、`discs`（我方子数，2 位，tone mint）、`ai`（对手子数，2 位，tone red）
- 文案：tagline `八乘八翻转，三局定输赢`；duration `2–5 分钟`
- tags：`一手可翻多子`、`三局两胜`、`无子可下即弃手`
- `pad: { dpad: "four", a: { action: "primary", label: "落子" }, b: { action: "secondary", label: "提示" } }`
- `countdown: false`

**规则**

- 8×8 棋盘，cell 19，起点 (8,8)，间距 1；初始四子固定在中央（黑白各两子，黑先手）。
- 玩家执黑先行，对手是 AI，共下 **3 局**；每局结束（双方都无合法手）后清盘重开。
- 合法手判定：落子后八方向任一方向必须夹住至少一对方子并可翻转。
- 翻转：八方向全部执行，不设上限。
- **无合法手自动弃手**；双方都无合法手 → 本局结束。
- AI：贪心 + 1 层前瞻——对每个合法手打分 `翻转数*10 + 边角加成(角 +60, 角邻 -25) + 随机 0~8`，选最高。
- 计分：每局 `赢 +100 / 平 +30 / 输 0`，再加 `(我方子数 - 对方子数)`；三局累加。
- 结算 `kicker: "GAME SET"`，stats：`胜局`、`总子数差`。
- `b` / 提示：高亮当前所有合法手 1.5 秒。
- 键盘：方向键移动光标，Enter/空格落子（`spaceAction: "action"`）。

**logic.ts 必须导出**

`SIZE=8`, `createBoard()`, `indexOf(x,y)`, `initialBoard()`, `isLegal(board, idx, color)`, `legalMoves(board, color)`, `applyMove(board, idx, color)`（返回新盘或原地，约定清楚）, `flipsFor(board, idx, color)`, `countDiscs(board)`, `isGameOver(board)`, `aiPick(board, color, rng)`, `scoreRound(mine, theirs)`

**单测重点**：初始四子布局、开局黑只有 4 个合法手、八方向翻转、翻不过去的位置不合法、无子可下返回空、终局判定、AI 必选合法手、计分公式。

---

## 13. lights · 关灯谜题

- `size: { w: 168, h: 168 }`，`scoreMode: "low"`（步数越少越好），`scoreLabel: "步数"`，`bestLabel: "最少步数"`
- HUD：`moves`（步数，3 位，tone score）、`left`（还亮着的灯，2 位，tone red）、`level`（关数，2 位，tone mint）
- 文案：tagline `点一盏，翻转上下左右`；duration `1–3 分钟`
- tags：`步数越少越好`、`五关递进`、`必定有解`
- `pad: { dpad: "four", a: { action: "primary", label: "翻转" } }`
- `countdown: false`

**规则**

- 5×5 共 25 盏灯，点一盏把它自己和上下左右邻居翻转（边角自动少翻）。
- 关卡由「从全灭状态随机打散」生成，因此**保证可解**；打散步数 `scrambleSteps(level) = 3 + level*2`（第 1 关 3 步起）。
- 共 **5 关**，每关步数独立统计，本局总步数 = 5 关之和（越低越好）。
- 点亮全灭（所有灯灭）→ 过关，短暂闪光 700ms 后进入下一关。
- 第 5 关完成 → `ctx.end({ score: 总步数 })`，`kicker: "CLEAR"`。
- 键盘：方向键移动光标，Enter 翻转。

**logic.ts 必须导出**

`SIZE=5`, `CELLS=25`, `neighborsOf(idx)`, `toggle(board, idx)`, `createBoard()`, `isSolved(board)`, `scramble(level, rng)`, `movesToSolve` 不要求，`cursorStep(idx, action, size)`

**单测重点**：角/边/中心翻转的邻居数（3/4/5）、翻转两次复原、打散后可解（用打散路径反推）、`isSolved` 只认全灭、光标移动不越界。

---

## 14. stack · 像素堆塔

- `size: { w: 168, h: 210 }`，`scoreMode: "high"`，`spaceAction: "action"`
- HUD：`score`（分数，pad 5）、`floor`（层数，2 位，tone combo）、`combo`（完美连击，2 位，tone gold）
- 文案：tagline `对准了再落，越堆越窄`；duration `45–90 秒`
- tags：`完美 +连击`、`越堆越快`、`落空即结束`
- `pad: { a: { action: "action", label: "落下" } }`（不要 dpad）

**规则**

- 塔从底部 (0, 178) 开始，首块宽 96 高 14，居中。
- 新块在顶部 y=26 处左右正弦摆动：`swingX(t, width, range)`，`speedForFloor(floor)` 从 1.6 提升到 4.2 rad/s。
- 按 A 落下，落点与上一块的重叠部分保留，超出的部分被裁掉（掉落碎块动画）。
- 重叠为 0 → 结束，`title: "塔塌了"`。
- **完美判定**：落点偏移 ≤ 3px → 保留右边缘并回赠 4px 宽度（最多回到 96），连击 +1。
- 连击 ≥ 3 时 HUD combo 变金色，音效升级。
- 每成功一层 +`10 + combo*5` 分。
- 摄像机跟随：塔高超过 100px 后整体上移。
- stats：`最高层`、`完美次数`。

**logic.ts 必须导出**

`START_WIDTH=96`, `BLOCK_H=14`, `swingX(t, speed, range)`, `speedForFloor(floor)`, `cropOverlap(prevX, prevW, x, w)`（返回 `{x, w, offset}`）, `isPerfect(offset)`, `scoreForFloor(floor, combo)`, `cameraFor(stackTop)`

**单测重点**：裁剪区间三种情况（左偏/右偏/包含）、完美容差边界 3px、计分公式、摆动不越界、相机不倒退。

---

## 15. simon · 记忆节拍

- `size: { w: 168, h: 168 }`，`scoreMode: "high"`，`countdown: false`
- HUD：`round`（轮次，2 位，tone combo）、`score`（分数，pad 5）、`best`（最高，pad 5，tone time）
- 文案：tagline `记住顺序，一拍不错`；duration `30–90 秒`
- tags：`每轮 +1 步`、`回放越来越快`、`按错即结束`
- `pad: { dpad: "four", a: { action: "primary", label: "确认" } }`（四向对应四色）

**规则**

- 四色四键：上=amber、右=mint、下=lav、左=pink，同时配四个不同音高的音。
- 序列从 1 步开始，每轮 +1 步，随机取四色之一。
- 回放速度 `playbackSpeedForRound(round)`：每步亮 420ms，随轮次线性缩短到 180ms 下限；步间停顿 120ms。
- 玩家按顺序复现；按错立刻结束。
- 每次正确复现 +`round * 10` 分。
- 回放期间输入无效（必须忽略）。
- 键盘：方向键 / WASD；触屏：点四象限。
- stats：`最长序列`、`轮次`。

**logic.ts 必须导出**

`COLORS`（四个动作名）, `nextStep(seq, rng)`, `judge(seq, inputs)`（返回 `"playing" | "correct" | "wrong"`）, `playbackSpeedForRound(round)`, `pauseForRound(round)`, `scoreForRound(round)`

**单测重点**：序列只增长不缩短、前缀正确判定、多按/按错判定、速度下限、计分。

---

## 16. hoop · 像素投篮

- `size: { w: 168, h: 210 }`，`scoreMode: "high"`，`spaceAction: "action"`
- HUD：`score`（分数，pad 5）、`shots`（剩余球数，2 位，tone red）、`combo`（连中，2 位，tone gold）
- 文案：tagline `蓄力出手，连中会冒火`；duration `60 秒`
- tags：`空心 +15`、`连中 ×2`、`十球一轮`
- `pad: { a: { action: "action", label: "出手" } }`（不要 dpad）

**规则**

- 篮筐在右侧 x=132, y=96，宽 26；球从左侧 (30, 170) 抛出。
- 两段式：按住 A 蓄力（力度条 0→1 来回摆动，`powerFromHold(holdMs)` 周期 1100ms），松手出手。
- 抛射角固定 62°，初速 `speedFromPower(power)`：min 250 → max 430 px/s。
- 重力 900px/s²，抛物线积分；判定进球：球心穿过筐口 y 区间且 x 在筐宽内。
- **空心**（没碰到筐沿）：+15 且连击 +1；擦筐进：+10 不连击；不进：连击清零。
- 连中 ≥ 3：球变金色，`combo` HUD 变金。
- 每轮 10 球，60 秒到或球用完 → 结算。
- stats：`命中率`、`最长连中`。

**logic.ts 必须导出**

`powerFromHold(holdMs)`, `speedFromPower(power)`, `ANGLE_DEG=62`, `stepBall(b, dtMs)`, `shoot(origin, power)`, `inRim(ball, rim)`, `isSwish(ball, rim)`, `scoreFor(make, swish, combo)`, `comboAfter(make, combo)`

**单测重点**：力度周期回归 [0,1]、初速映射两端、抛体在定步长下稳定、筐口判定边界、空心 vs 擦筐、连击清零与倍率。

---

## 17. sokoban · 像素推箱子

- `size: { w: 168, h: 168 }`，`scoreMode: "low"`（步数越少越好），`scoreLabel: "步数"`，`bestLabel: "最少步数"`
- HUD：`moves`（步数，3 位，tone score）、`boxes`（已就位/总数，显示就位数，2 位，tone mint）、`level`（关数，2 位，tone combo）
- 文案：tagline `只能推，不能拉`；duration `2–5 分钟`
- tags：`推箱子到位`、`可撤销一步`、`六关递进`
- `pad: { dpad: "four", b: { action: "secondary", label: "撤销" } }`
- `countdown: false`

**规则**

- 6 张手写关卡，8×8 网格，cell 19，起点 (8,8)，间距 1。
- 推箱规则：走到空格可移动；走到箱子时，若箱子后面是空地/目标点则可推，否则不能动。
- 目标：所有箱子都在目标点上 → 过关，进入下一关。
- 步数累计 6 关总和；**每关至少验证一条已知解**（单测里用解序列跑通）。
- 撤销：`b` 键回退一步（无限次，但撤销不减少已计步数——步数按实际移动计）。
- 第 6 关完成 → 结算，`kicker: "CLEAR"`。
- 键盘方向键移动。

**logic.ts 必须导出**

`SIZE=8`, `parseLevel(rows)`（字符串数组 → `{ walls, goals, boxes, player }`）, `LEVELS`（6 条字符串关卡）, `move(state, dir)`（返回 `{ state, moved, pushed, win }`）, `isWin(state)`, `undo(state)`, `boxRatio(state)`

**单测重点**：推入墙失败、推两个箱子失败、推到目标点计就位、撤销恢复原状、6 关都有解（用写死的解序列跑）、边界不越界。

---

## 18. hop · 青蛙过河

- `size: { w: 168, h: 210 }`，`scoreMode: "high"`
- HUD：`score`（分数，pad 5）、`lives`（生命，2 位，tone red）、`row`（最远到过的行，2 位，tone mint）
- 文案：tagline `躲开车，踩着木头过河`；duration `1–3 分钟`
- tags：`每行 +10`、`到对岸 +100`、`落水撞车即减命`
- `pad: { dpad: "four", a: { action: "primary", label: "前进" } }`

**规则**

- 13 行 × 7 列网格，cell 24，起点 (0, 0)，画布 168×210（13*24 = 312 > 210，所以**行数改成 8 行**：1 起点带 + 5 车道/河道 + 1 对岸带）。
- 具体行布局（自上而下）：`home`(y=0) / `water`×2 / `safe` / `road`×2 / `safe` / `start`(y=168)。
- 道路车道：车以 `laneSpeed(lane)` 移动，撞到车 → 减 1 命，回到起点带。
- 河道：木头以 `laneSpeed(lane)` 移动，站上去会被带走，`rideDelta(wood, dtMs)`；水里没有木头 → 落水减 1 命。
- 每次**首次到达某行** +10 分；到对岸 +100 并重置回起点。
- 生命 0 → 结算，`title: "被车流拦住了"`。
- stats：`最远行数`、`过河次数`。

**logic.ts 必须导出**

`COLS=7`, `ROWS=8`, `CELL=24`, `LANES`, `rowKind(row)`, `laneSpeed(row, level)`, `gridToPx(col, row)`, `pxToGrid(x, y)`, `rideDelta(wood, dtMs)`, `scoreForRow(row)`, `clampCol(col)`

**单测重点**：行类型表、坐标互转可逆、木头带人位移、速度方向交替、计分（首次 vs 重复）、越界夹住。

---

## 19. claw · 像素抓娃娃

- `size: { w: 168, h: 210 }`，`scoreMode: "high"`，`spaceAction: "action"`
- HUD：`score`（分数，pad 5）、`tries`（剩余次数，2 位，tone red）、`streak`（连抓，2 位，tone gold）
- 文案：tagline `对准了再下钩`；duration `60–90 秒`
- tags：`越准越好抓`、`三档奖品`、`十次机会`
- `pad: { dpad: "lr", a: { action: "action", label: "下钩" } }`

**规则**

- 爪子悬在 y=24，x 在 12..156 之间左右移动（键盘 90px/s，按住持续）。
- 奖品躺在底部 y=170 一层，宽 20–26，三档：`small`(10 分) / `mid`(25 分) / `big`(60 分)，各自权重 60/30/10。
- 按 A 下钩：钩子下降 150px/s 到底，闭合，然后上升。
- **抓取概率随水平对准度平滑上升**：`grabChance(offset)`，`offset = |clawX - prizeX|`，offset 0 → 0.92，offset ≥ 24 → 0.06，中间线性（**不是纯随机**）。
- 抓住后奖品跟随上升，到顶计入分数；没抓住爪子空手上来。
- 连抓 +1 时下次概率 +0.04（上限 0.96），空手清零。
- 10 次机会用完 → 结算，stats：`抓中次数`、`最高连抓`。

**logic.ts 必须导出**

`CLAW_MIN=12`, `CLAW_MAX=156`, `PRIZE_TIERS`, `grabChance(offset, streak)`, `layoutPrizes(width, rng)`（返回不重叠的奖品数组）, `overlap(a, b)`, `clawSpeed(hold)`, `scoreForPrize(tier, streak)`, `pickPrize(prizes, clawX)`

**单测重点**：概率单调递减且在 [0.06,0.92] 内、连抓加成封顶、奖品布局不重叠、对准时选中最近奖品、计分。

---

## 20. pong · 像素乒乓

- `size: { w: 168, h: 168 }`，`scoreMode: "high"`，`spaceAction: "action"`
- HUD：`score`（我方得分，2 位，tone score）、`ai`（对手得分，2 位，tone red）、`rally`（回合拍数，2 位，tone combo）
- 文案：tagline `七分制，球越打越快`；duration `1–3 分钟`
- tags：`七分制`、`每回合加速`、`拍数越多分越高`
- `pad: { dpad: "lr", a: { action: "action", label: "发球" } }`
- `countdown: false`

**规则**

- 球场 168×168，上下边界留 6px；左右挡板 4×28，x=6 与 x=158。
- 球半径 2（画 4×4 方块），初速 110px/s，方向随发球随机偏转 ±30°。
- 击中挡板：按**命中点相对挡板中心的偏移**反弹，`reflectAngle(offset)` 映射 -60°..+60°（offset 归一化到 -1..1）。
- 球速每回合 +6%，上限 260px/s。
- 玩家挡板：方向键 / 触屏拖拽（x 映射到 y，因为竖屏，挡板在左右**上下移动**——具体实现见下）。
- **竖屏适配**：左右挡板改为**上下移动**，球在竖直方向反弹，得分方向为上下得分。即开球在中央，上下各一个挡板，玩家控制下方挡板。
- 先到 7 分者胜；玩家 7 分 → `kicker: "WIN"`；AI 7 分 → 结算。
- 每拍到球 +1 分（`rally` 计数），赢一分 +50。
- AI 挡板：`aiTarget(ball, level)` 有最大速度限制与反应延迟，禁止瞬移。
- stats：`最长回合`、`AI 得分`。

**logic.ts 必须导出**

`FIELD=168`, `PADDLE_H=28`, `BALL_R=2`, `BASE_SPEED=110`, `MAX_SPEED=260`, `reflectAngle(offset)`, `speedUp(speed, rally)`, `aiTarget(ball, level)`, `clampPaddle(y)`, `serveAngle(rng)`, `scoreForRally(rally, won)`

**单测重点**：反弹角度对称且不垂直、速度上限、AI 不超速、挡板不出界、发球角度范围、计分。

---

## 完成后自检

```bash
npx tsc -p tsconfig.json --noEmit        # 只看自己目录的报错
npx vitest run games/<id>                # 单测必须全绿
```

**不要运行 `vite build`**（会和集成任务抢 `dist/`）。
