import type { Palette, PaletteKey } from "./palette";
import type { PixelSurface } from "./render/surface";
import type { PointerInput } from "./input/pointer";
import type { KeyMap } from "./input/keys";
import type { SwipeInput } from "./input/swipe";
import type { Sound } from "./audio";
import type { Store, ScoreMode } from "./store";
import type { Hud, HudSlot } from "./ui/hud";
import type { FullscreenController } from "./fullscreen";
import type { Toast } from "./ui/toast";

export interface GameMeta {
  /** 唯一 id，同时是存档 key。 */
  id: string;
  /** 合集里的机位编号 1–10。 */
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
  /** 触屏设备上点「开始」自动进全屏，默认 true。 */
  autoFullscreen?: boolean;
  /** 空格键归谁：'pause'（默认）或 'action'（游戏用）。 */
  spaceAction?: "pause" | "action";
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
  fullscreen: FullscreenController;
  reducedMotion: boolean;
  announce: (message: string) => void;
  /** 本局结束，交给壳层结算。 */
  end: (result: GameResult) => void;
  /** 当前是否处于暂停（游戏可用来跳过动画）。 */
  isPaused: () => boolean;
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
