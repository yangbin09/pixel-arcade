# 新游戏速查卡（给并行开发的子代理）

> 完整契约见 [`docs/GAME_API.md`](GAME_API.md)，但**开发时只需要这份卡片**。
> 数值规格见 [`docs/game-specs-vol03.md`](game-specs-vol03.md) 里你自己那一节。

## 只允许碰你自己的目录

```
games/<你的 id>/
├─ package.json        # 10 行，照抄 games/mines/package.json 只改包名
├─ src/meta.ts         # GameMeta + drawThumb
├─ src/index.ts        # export default defineGame({ meta, create })
├─ src/logic.ts        # 纯函数规则层（单测只测这个文件）
├─ src/art.ts          # 像素素材，meta 的 drawThumb 复用它
└─ test/<id>.test.ts   # ≥12 条 it()，node 环境，不 import DOM
```

**禁止**修改 `packages/`、`site/`、`*.html`、`vite.config.ts`、`slots.json`、
`bundle-budget.json`、`package-lock.json`、`scripts/`、`docs/`、`README.md`。
**禁止**运行 `npm run build` / `npm run dev`（多任务并行会抢 `dist/`）。
只允许：`npx tsc -p tsconfig.json --noEmit` 和 `npx vitest run games/<你的 id>`。

## 骨架

```ts
// src/index.ts
import { P, defineGame, rect, type GameContext, type GameInstance } from "@arcade/core";
import { meta } from "./meta";
import { /* 你自己的纯函数 */ } from "./logic";

export default defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let mode: "ready" | "playing" | "over" = "ready";

    const reset = (): void => { /* 重置本局状态 + 同步 HUD */ };

    const finish = (): void => {
      if (mode === "over") return;        // ← 必须守卫，ctx.end() 只能一次
      mode = "over";
      ctx.end({ score, title: "…", kicker: "…", stats: [{ label: "…", value: "…" }] });
    };

    reset();
    return {
      start() { reset(); mode = "playing"; },
      update(dt) { if (mode !== "playing") return; /* dt 是毫秒，已钳在 50ms 内 */ },
      render() { /* 只用 ctx.ctx 画 */ },
      pause() {}, resume() {}, destroy() {},
    };
  },
});
```

## 硬性红线（写错就要返工）

1. **`dt` 是毫秒**，不是秒。所有「每秒 xxx 像素」的常量都要 `dt / 1000`。
2. **`ctx.end()` 只能调用一次**，用 `mode === "over"` 守卫。
3. **不要写 `ctx.store.setBest`**，最高分由壳层按 `scoreMode` 写入。
4. **不要用** `ctx.fillText` / `ctx.font` / 外部图片 / 外部字体 / `fetch`。
5. **颜色只能取 `P.*`**（24 色，见 `packages/core/src/palette.ts`）。
6. **像素字只支持** `0-9 A-Z + - ! ? % : . / *` 和空格，**中文会渲染成 `?`**。
   中文只能放 `label` / `title` / `howto` / `toast` / 结算文案。
7. **单帧内不要创建 canvas**；静态背景用 `document.createElement("canvas")` 缓存一次。
8. `logic.ts` **不 import DOM、不调用 `Math.random()`**——随机源由调用方传入。
9. **`size.w` 固定 168，`size.h` 只能是 168 或 210**（走已调好的机台 CSS）。

## 绘图 API（`@arcade/core`）

```ts
rect(ctx, x, y, w, h, color)        fillEllipse(ctx, cx, cy, rx, ry, color)
fillCircle(ctx, cx, cy, r, color)   line(ctx, x0, y0, x1, y1, color, width?)
strokeRect(ctx, x, y, w, h, color)  bevel(ctx, x, y, w, h, face, light, dark)
sparkle(ctx, x, y, r, color, core)  drawPixelText(ctx, text, x, y, scale, color, bg?)
measurePixelText(text, scale)       → number
```

## 音效（`ctx.audio.*`，全是 WebAudio 合成）

`coin() pop() blip() hit(combo) gold() miss() spawn(gold) tick(step) go() end()
tier() win() lose() error() slide() ui()`
以及 `tone(freq, dur, type, vol, slideTo, delay)` / `noise(dur, vol, type, freq)`。

## HUD

```ts
ctx.hud.set("score", 1230);          ctx.hud.flash("score", "is-bump");
ctx.hud.setColor("score", P.gold);   ctx.hud.setSuffix("combo", "×3", "is-hot");
ctx.hud.urgent(true);                ctx.timer.set(remainingMs, totalMs); ctx.timer.hide();
```

`meta.hud` 是 1–3 栏。数值要 `clamp` 到位数（`pad` / `minChars`），否则撑破布局。

## 输入：触屏 + 键盘两条通路都必须有

```ts
ctx.input.pointer.on("down", (info) => { info.x, info.y, info.source.pointerType });
ctx.input.keys.onPress((action) => { /* "left"|"up"|"slot3"|"action"|"primary" */ });
ctx.input.keys.isDown("left");
ctx.input.swipe.onSwipe(({ direction }) => {});
ctx.padVisible();   // 手柄显示时，画布内的触屏按钮要隐藏，避免重复
```

`meta.pad` 不写就没有虚拟手柄。**除纯点击类游戏外必须写 `pad`**，
否则触屏玩家没有操作入口。

## 结算

```ts
ctx.end({
  score,
  title: "时间到",
  kicker: "TIME UP",
  stats: [{ label: "最高连击", value: 12 }],   // 0–2 条，第 3 条壳层补历史最佳
});
```

`scoreMode: "low"`（用时/步数）越小越好。

## 参考实现（按需读 1 个，不要贪多）

| 你要写的东西 | 读这个 |
|---|---|
| 网格 + 光标 + 键盘 | `games/mines/src/index.ts` |
| 反应类 / 计时类 | `games/whack/src/index.ts` |
| 纯物理推演 | `games/runner/src/logic.ts` |
| 单测写法（≥12 条） | `games/mines/test/mines.test.ts` |

## 交付前自检（缺一不可）

```bash
npx tsc -p tsconfig.json --noEmit          # 零错误
npx vitest run games/<你的 id>             # 全绿，≥12 条
```

并确认：
- [ ] `meta.id` 等于目录名，`meta.no` 等于规格里写的机位号
- [ ] `ctx.end()` 在源码里只出现一次调用点
- [ ] 没有 `fillText` / `ctx.font` / 外部资源 / `setBest`
- [ ] 没有留下 `*.tmp.test.ts`、`_tmp_*`、`diag*` 之类的临时文件
- [ ] 文件是**合法 UTF-8**（含中文注释时最容易坏，用编辑器保存，别用管道拼接）
