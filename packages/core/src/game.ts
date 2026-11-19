import type { Palette, PaletteKey } from "./palette";
import type { PixelSurface } from "./render/surface";
import type { PointerInput } from "./input/pointer";
import type { KeyMap } from "./input/keys";
import type { SwipeInput } from "./input/swipe";
import type { Sound } from "./audio";
import type { Store, ScoreMode } from "./store";
import type { Hud, HudSlot } from "./ui/hud";
import type { Toast } from "./ui/toast";

/** 虚拟手柄上的一个按键：语义动作 + 面板上的短标签。 */
export interface PadButtonSpec {
  /** 传给 KeyMap 的动作名，和键盘动作共用一套。 */
  action: string;
  /** 按键下方的小字，建议 2–4 个字。 */
  label: string;
}

/**
 * 虚拟手柄布局。只声明游戏真正需要的键：
 * 贪吃蛇只有 D-pad，扫雷有 D-pad + A/B，打砖块有左右 + A。
 */
export interface PadSpec {
  /** 十字键：none / lr（只有左右）/ four（四向）。默认 none。 */
  dpad?: "none" | "lr" | "four";
  /** 自定义方向动作，默认 left/right/up/down。 */
  up?: string;
  down?: string;
  left?: string;
  right?: string;
  /** A 键（主操作）。 */
  a?: PadButtonSpec;
  /** B 键（次操作）。 */
  b?: PadButtonSpec;
  /** 是否显示 START（开始/暂停），默认 true。 */
  start?: boolean;
}

export interface GameMeta {
  /** 唯一 id，同时是存档 key。 */
  id: string;
  /** 合集里的机位编号 1–30。 */
  no: number;
  title: string;
  /** 卡片上的一句话（≤ 18 字）。 */
  tagline: string;
  /** 准备面板里的玩法说明。 */
  howto: string;
  /** 准备面板底部按键提示，允许 HTML（kbd）。 */
  hint?: string;
  /** 单局时长描述，如 "30 秒一局"。 */
  duration: string;
  tags: string[];
  /** 逻辑分辨率（像素画布尺寸）。 */
  size: { w: number; h: number };
  hud: HudSlot[];
  scoreMode?: ScoreMode;
  /** 结算分数标题，默认「本局得分」。 */
  scoreLabel?: string;
  /** 最佳成绩标题，默认「历史最高」。 */
  bestLabel?: string;
  /** 是否让壳层画 3-2-1 倒计时；打地鼠自己画，设为 false。 */
  countdown?: boolean;
  /** 空格键归谁：'pause'（默认）或 'action'（游戏用）。 */
  spaceAction?: "pause" | "action";
  /** 虚拟手柄布局；不写则不显示手柄。 */
  pad?: PadSpec;
  /** 首页缩略图：80×50 逻辑像素，t 为秒。 */
  drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void;
}

export interface GameResult {
  /** 主成绩：高分模式越大越好，低分模式越小越好。 */
  score: number;
  /** 结算标题，默认「时间到」。 */
  title?: string;
  /** 结算小标题，默认 RESULT。 */
  kicker?: string;
  /** 0–2 条附加统计，第三条永远是历史最佳（壳层补）。 */
  stats?: { label: string; value: string | number }[];
}

export interface TimerOptions {
  /** 低于该比例变橙色，默认 0.34。 */
  low?: number;
  /** 低于该比例变红色闪烁，默认 0.15。 */
  critical?: number;
}

export interface TimerControl {
  /** 顶部计时条：剩余 / 总时长（毫秒）。 */
  set(remaining: number, total: number, options?: TimerOptions): void;
  hide(): void;
}

export interface GameInstance {
  /** 开始或重开一局；shell 已经清空 HUD。 */
  start(): void;
  update(dt: number): void;
  render(): void;
  pause?(): void;
  resume?(): void;
  destroy?(): void;
}

export interface GameContext {
  meta: GameMeta;
  P: Palette;
  surface: PixelSurface;
  ctx: CanvasRenderingContext2D;
  input: {
    pointer: PointerInput;
    keys: KeyMap;
    swipe: SwipeInput;
  };
  audio: typeof Sound;
  store: typeof Store;
  hud: Hud;
  toast: Toast;
  timer: TimerControl;
  reducedMotion: boolean;
  announce: (message: string) => void;
  /** 本局结束，交给壳层结算。 */
  end: (result: GameResult) => void;
  /** 当前是否处于暂停（游戏可用来跳过动画）。 */
  isPaused: () => boolean;
  /** 虚拟手柄是否正在显示（游戏可据此隐藏画布内的触屏按钮）。 */
  padVisible: () => boolean;
  /** 调色板里的颜色，写起来短一点。 */
  color: (key: PaletteKey) => string;
}

export interface GameModule {
  meta: GameMeta;
  create(ctx: GameContext): GameInstance;
}

/** 类型辅助：写游戏时不用手写泛型。 */
export function defineGame(module: GameModule): GameModule {
  return module;
}
