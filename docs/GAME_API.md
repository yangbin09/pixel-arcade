# 游戏开发契约（@arcade/core v1）

一个游戏 = 一个目录 `games/<id>/`，两个入口文件：

```
games/<id>/
├─ package.json          # @arcade/game-<id>，exports 指向 src
├─ src/meta.ts           # 轻量元数据 + 首页缩略图（首页会 eager 加载）
├─ src/index.ts          # export default defineGame({ meta, create })
├─ src/art.ts            # 可选：像素素材
└─ test/<id>.test.ts     # 可选：纯逻辑单测（vitest）
```

首页与播放壳通过 `import.meta.glob` **自动发现**游戏：

- `../games/*/src/meta.ts` → 首页卡片
- `../games/*/src/index.ts` → `play/?game=<id>` 懒加载

**不要修改** `packages/`、`site/`、`index.html`、`play/`、`vite.config.ts`、`slots.json`。
新游戏只需要新增自己的目录，编号/顺序由 `packages/registry/slots.json` 决定（已列好 10 个 id）。

## 最小可用示例

```ts
// src/meta.ts
import { P, rect, type GameMeta } from "@arcade/core";

export const meta: GameMeta = {
  id: "snake",
  no: 2,
  title: "贪吃蛇",
  tagline: "吃到 20 颗，别咬到自己",
  howto: "滑动或方向键转向，吃掉果实会变长。撞墙或咬到自己就结束。",
  hint: "方向键 / WASD 转向 · <kbd>空格</kbd> 暂停",
  duration: "1–3 分钟",
  tags: ["果实 +10", "每 5 颗加速", "撞墙即结束"],
  size: { w: 168, h: 168 },
  scoreMode: "high",
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "length", label: "长度", kind: "number", minChars: 2, tone: "combo" },
    { key: "best", label: "最高", kind: "number", pad: 5, minChars: 5, tone: "time" },
  ],
  drawThumb(ctx, w, h) {
    rect(ctx, 0, 0, w, h, P.night);
    // ... 用 P 里的颜色画 80×50 的缩略图
  },
};

// src/index.ts
import { P, defineGame, type GameContext, type GameInstance } from "@arcade/core";
import { meta } from "./meta";

export default defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let score = 0;

    return {
      start() {
        score = 0;
        ctx.hud.set("score", 0);
      },
      update(dt) {
        // dt 是毫秒，已被钳制在 50ms 以内
      },
      render() {
        ctx.ctx.fillStyle = P.night;
        ctx.ctx.fillRect(0, 0, meta.size.w, meta.size.h);
      },
      pause() {},
      resume() {},
      destroy() {},
    };
  },
});
```

## 生命周期

播放壳负责：HUD 容器、准备/暂停/结算面板、倒计时（默认）、最高分、全屏、静音、错误兜底。

| 时机 | 调用 |
|---|---|
| 页面打开 | `create()` → `render()`（画静态画面），壳层显示准备面板 |
| 点开始 / 再来一局 | `start()`（重置本局状态） |
| 每帧 | `update(dt)` → `render()` |
| 暂停 / 恢复 | `pause()` / `resume()`（update 已停，render 不再调用） |
| 结算 | 游戏调用 `ctx.end(result)`，壳层写存档并显示结果面板 |

- `ctx.end()` 只能调用一次；调用后壳层进入 `over` 状态并停止循环。
- 不要在游戏里自己操作 `#overlay`、`#hud`、`#toast`、`#field` 的 DOM 结构。
- 需要倒计时就用默认（壳层画在 `#fx` 层）；需要自己画（像打地鼠）就在 meta 里写 `countdown: false`。

## GameMeta

```ts
interface GameMeta {
  id: string;            // 必须与目录名、slots.json 一致
  no: number;            // 机位号，slots.json 已定义
  title: string;
  tagline: string;       // 卡片一句话，≤ 18 字
  howto: string;         // 准备面板玩法说明，60–100 字
  hint?: string;         // HTML，可含 <kbd>
  duration: string;      // "30 秒一局" / "1–3 分钟"
  tags: string[];        // 1–4 条，显示在画面下方
  size: { w: number; h: number };   // 逻辑分辨率
  hud: HudSlot[];        // 1–3 栏
  scoreMode?: "high" | "low";       // 默认 high
  scoreLabel?: string;   // 默认「本局得分」
  bestLabel?: string;    // 默认「历史最高」
  countdown?: boolean;   // 默认 true，壳层画 3-2-1
  autoFullscreen?: boolean;         // 默认 true，触屏点开始自动全屏
  spaceAction?: "pause" | "action"; // 空格归谁，默认 pause
  pad?: PadSpec;         // 虚拟手柄布局，见下
  drawThumb(ctx, w, h, t): void;    // 80×50 逻辑像素，t 为秒
}
```

## 虚拟手柄

每款游戏在 `meta.ts` 里声明自己需要哪些键，壳层负责画出来、处理多指和触感。
动作名和键盘共用一套（`left/right/up/down/action/primary/secondary/slot1…`）。

```ts
interface PadSpec {
  dpad?: "none" | "lr" | "four"; // 默认 none；lr 只有左右，four 是四向
  up?: string;                   // 自定义方向动作，默认 up/down/left/right
  down?: string;
  left?: string;
  right?: string;
  a?: { action: string; label: string }; // A 键：大字母 + 下方 2–4 字标签
  b?: { action: string; label: string }; // B 键
  start?: boolean;               // 默认 true，显示 START（准备界面开局 / 游戏中暂停）
}
```

示例（俄罗斯方块）：

```ts
pad: {
  dpad: "four",
  a: { action: "up", label: "旋转" },     // 和 ↑ 同一个动作
  b: { action: "action", label: "落下" },
}
```

- 游戏不需要知道手柄在哪个位置；按下时壳层会调用 `KeyMap.press(action)`，和键盘走同一条通路。
- 同一个动作被两个键同时按住时，壳层用计数避免提前松开。
- 画布内的触屏按钮/光标可以用 `ctx.padVisible()` 判断是否要显示，避免和手柄重复。
- 玩家可以在机台顶部用 PAD 开关收起手柄，状态存在 `pixelArcade.setting.pad`。

## HUD

```ts
interface HudSlot {
  key: string;
  label: string;
  kind?: "number" | "text" | "time"; // time 传毫秒，自动向上取整成秒
  pad?: number;      // 补零
  minChars?: number; // 固定宽度，防抖动
  tone?: "time" | "score" | "combo" | "mint" | "gold" | "red" | "none";
  color?: PaletteKey; // 覆盖文字颜色
  suffix?: string;    // 小字，如 "×2"
}
```

```ts
ctx.hud.set("score", 1230);
ctx.hud.setColor("score", P.gold);
ctx.hud.setSuffix("combo", "×3", "is-hot"); // 类名可选："" | "is-hot" | "is-max"
ctx.hud.flash("score", "is-bump");          // 或 "is-broken"
ctx.hud.urgent(true);                       // 时间栏变红闪
```

**像素字库只支持 `0-9 A-Z + - ! ? % : . / *` 和空格**，中文会显示为 `?`。
中文文案请放在 `label` / `toast` / 弹窗里，不要塞进 HUD 数值。

计时条：

```ts
ctx.timer.set(remainingMs, totalMs, { low: 0.34, critical: 0.15 });
ctx.timer.hide();
```

## 输入

```ts
// 指针：坐标已经是逻辑像素
ctx.input.pointer.on("down" | "move" | "up" | "cancel" | "leave", (info) => {
  info.x, info.y, info.down, info.source.pointerType, info.source.button;
});

// 键盘：动作名由壳层统一绑定
ctx.input.keys.onPress((action, event) => { /* "left" | "up" | "slot3" | "action" ... */ });
ctx.input.keys.onRelease((action) => {});
ctx.input.keys.isDown("left");

// 滑动：方向识别，触屏和鼠标拖拽都行
ctx.input.swipe.onSwipe(({ direction, dx, dy, duration }) => {});

// 虚拟手柄当前是否显示（用于隐藏画布内的触屏按钮/光标）
ctx.padVisible();
```

默认键位：`方向键/WASD → left/right/up/down`，`Enter → action`，
`Z/X/C → primary/secondary/third`，`1–9 → slot1..slot9`。
空格默认暂停；要拿空格做操作就在 meta 里写 `spaceAction: "action"`（此时空格映射为 `action`）。

## 绘图

画布已经是「逻辑像素坐标」，`ctx.ctx` 上的 transform 由引擎维护，直接按 `size.w/h` 画。

```ts
import { P, rect, fillEllipse, fillCircle, line, strokeRect, bevel, sparkle,
         drawPixelText, measurePixelText, PixelText } from "@arcade/core";

rect(ctx, x, y, w, h, P.amber);
fillCircle(ctx, cx, cy, r, P.gold);
sparkle(ctx, x, y, 2, P.gold, P.white);
drawPixelText(ctx, "HI 1200", x, y, 2, P.cream, P.void);
measurePixelText("HI 1200", 2); // 宽度
```

- 不要用 `ctx.font` / `fillText` / 外部图片 / 外部字体 —— 保持像素风。
- 不要给画布设置 CSS 尺寸，引擎会按整数倍缩放。
- 需要缓存静态背景时，自己建 `document.createElement("canvas")`，尺寸用**逻辑尺寸**，`drawImage(layer, 0, 0)`。

## 音效

全部 WebAudio 合成，无素材文件：

```ts
ctx.audio.unlock();              // 第一次点击时自动调用过，可再调
ctx.audio.coin(); ctx.audio.pop(); ctx.audio.blip();
ctx.audio.hit(combo); ctx.audio.gold(); ctx.audio.miss();
ctx.audio.spawn(gold); ctx.audio.tick(step); ctx.audio.go(); ctx.audio.end();
ctx.audio.tier(); ctx.audio.win(); ctx.audio.lose(); ctx.audio.error();
ctx.audio.slide(); ctx.audio.ui();
ctx.audio.tone(freq, duration, "square", volume, slideTo, delay);
ctx.audio.noise(duration, volume, "bandpass", frequency);
```

## 存档

```ts
ctx.store.best(meta.id, "high");   // number | null（low 模式没有记录时 null）
ctx.store.setBest(...);            // 一般不用自己写，壳层结算时处理
ctx.store.number("snake.best", 0);
ctx.store.bool("snake.tutorialSeen", false);
ctx.store.set("snake.whatever", "1");
```

> 最佳成绩由壳层根据 `scoreMode` 统一写入，游戏不要在结算时自己写。

## 结算

```ts
ctx.end({
  score: 1230,
  title: "时间到",           // 可选，默认「本局结束」
  kicker: "TIME UP",        // 可选，默认 RESULT
  stats: [                  // 0–2 条，第 3 条由壳层补「历史最佳」
    { label: "最高连击", value: 12 },
    { label: "命中率", value: "68%" },
  ],
});
```

低分模式（`scoreMode: "low"`，如用时/步数）：越小越好，`scorePad` 自动关掉。

## 其他

```ts
ctx.reducedMotion            // 尊重系统「减少动态效果」
ctx.announce("文字")          // 读屏播报，节制使用
ctx.toast.show("速度提升", { warn: true, duration: 1000 });
ctx.fullscreen.active / enter() / exit()
ctx.isPaused()
ctx.color("gold")            // === P.gold
ctx.meta
```

## 质量门槛（每款游戏必须满足）

1. `npx tsc -p tsconfig.json --noEmit` 自己的文件零错误。
2. 触屏可玩（pointer 事件），键盘也有等价操作。
3. 准备 → 开始 → 暂停 → 恢复 → 结算 → 再来一局，全流程闭环。
4. 结算调用一次 `ctx.end()`；最高分显示正确。
5. 单帧内不创建 canvas；不写 `localStorage` 以外的持久化。
6. 没有外部资源（图片/字体/音频/网络请求）。
7. 缩略图与游戏画面同一套调色板（`P`）。
8. 逻辑尺寸固定，任何窗口尺寸下都不糊、不拉伸。
