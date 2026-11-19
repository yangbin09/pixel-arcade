/**
 * 共享的假 Canvas 上下文 —— 给所有游戏的临时渲染验证用。
 *
 * 为什么存在：并行开发时不同子代理各造一套 mock canvas 会浪费大量时间，
 * 还会留下一堆 `*.tmp.test.ts` 垃圾。这里提供一份够用的实现，直接复用。
 *
 * 用法：
 *   import { makeFakeCtx } from "../../../tests/support/fake-ctx";
 *   const ctx = makeFakeCtx(168, 210);
 *   game.meta.drawThumb(ctx, 80, 50, 0);
 *   expect(ctx.calls.length).toBeGreaterThan(0);
 *
 * 注意：这是**辅助**工具，正式的 `test/<id>.test.ts` 只测 `logic.ts`（node 环境，
 * 不 import 本文件）。只有需要验证渲染不崩时才用它。
 */

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface FakeCtxOptions {
  /** 记录所有调用，默认 true。 */
  record?: boolean;
  /** 超过该数量的调用不再记录，防止内存爆掉。默认 20000。 */
  maxCalls?: number;
}

export interface FakeCtx extends CanvasRenderingContext2D {
  /** 按调用顺序记录的方法调用。 */
  calls: RecordedCall[];
  /** 记录到的 `fillText` 调用——用于断言「没有用外部字体绘制」。 */
  fillTextCalls: unknown[][];
  /** 记录到的 `drawImage` 调用——用于断言「没有加载外部图片」。 */
  drawImageCalls: unknown[][];
  /** 当前 canvas 的逻辑尺寸。 */
  logical: { w: number; h: number };
  /** 清空记录。 */
  reset(): void;
}

/**
 * 造一个最小可用的 CanvasRenderingContext2D 假实现。
 * 只实现 `@arcade/core` 的像素原语真正会用到的成员。
 */
export function makeFakeCtx(w: number, h: number, options: FakeCtxOptions = {}): FakeCtx {
  const record = options.record ?? true;
  const maxCalls = options.maxCalls ?? 20_000;

  const calls: RecordedCall[] = [];
  const fillTextCalls: unknown[][] = [];
  const drawImageCalls: unknown[][] = [];

  const note = (method: string, args: unknown[]): void => {
    if (!record || calls.length >= maxCalls) return;
    calls.push({ method, args });
  };

  /** 状态字段：像素原语会读写这些。 */
  const state: Record<string, unknown> = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: false,
    font: "10px monospace",
    textAlign: "start",
    textBaseline: "alphabetic",
    shadowBlur: 0,
    shadowColor: "transparent",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };

  const stack: Record<string, unknown>[] = [];
  const noop = (method: string) => (...args: unknown[]): void => {
    note(method, args);
  };

  const target: Record<string, unknown> = {
    ...state,
    canvas: { width: w, height: h },
    calls,
    fillTextCalls,
    drawImageCalls,
    logical: { w, h },
    reset(): void {
      calls.length = 0;
      fillTextCalls.length = 0;
      drawImageCalls.length = 0;
    },

    save(): void {
      note("save", []);
      stack.push({ ...target });
    },
    restore(): void {
      note("restore", []);
      const prev = stack.pop();
      if (!prev) return;
      for (const key of Object.keys(state)) {
        if (key in prev) target[key] = prev[key];
      }
    },
    setTransform: noop("setTransform"),
    resetTransform: noop("resetTransform"),
    translate: noop("translate"),
    scale: noop("scale"),
    rotate: noop("rotate"),
    clearRect: noop("clearRect"),
    fillRect: noop("fillRect"),
    strokeRect: noop("strokeRect"),
    beginPath: noop("beginPath"),
    closePath: noop("closePath"),
    moveTo: noop("moveTo"),
    lineTo: noop("lineTo"),
    arc: noop("arc"),
    ellipse: noop("ellipse"),
    rect: noop("rect"),
    fill: noop("fill"),
    stroke: noop("stroke"),
    clip: noop("clip"),
    drawImage(...args: unknown[]): void {
      note("drawImage", args);
      drawImageCalls.push(args);
    },
    createLinearGradient(): { addColorStop: () => void } {
      return { addColorStop: () => undefined };
    },
    createRadialGradient(): { addColorStop: () => void } {
      return { addColorStop: () => undefined };
    },
    createPattern(): null {
      return null;
    },
    measureText(text: string): { width: number } {
      // 像素字按每字符 6px 粗略估算，足够断言宽度非负
      return { width: String(text).length * 6 };
    },
    fillText(...args: unknown[]): void {
      note("fillText", args);
      fillTextCalls.push(args);
    },
    strokeText: noop("strokeText"),
    getImageData(): { data: Uint8ClampedArray } {
      return { data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData: noop("putImageData"),
  };

  // 让 fillStyle 之类的写入落到 target 上
  for (const key of Object.keys(state)) {
    Object.defineProperty(target, key, {
      get: () => state[key],
      set: (value: unknown) => {
        state[key] = value;
      },
      enumerable: true,
      configurable: true,
    });
  }

  return target as unknown as FakeCtx;
}

/** 造一个假 canvas 元素（只有 pixels 层会用到的那几个成员）。 */
export function makeFakeCanvas(w: number, h: number): HTMLCanvasElement {
  const ctx = makeFakeCtx(w, h);
  return {
    width: w,
    height: h,
    style: {},
    getContext: () => ctx,
    toDataURL: () => "data:image/png;base64,",
  } as unknown as HTMLCanvasElement;
}

/**
 * 极简的可复现随机源（LCG），和 `@arcade/core` 的 `mulberry32` 不冲突。
 * 游戏测试用它固定随机序列。
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
