import slots from "../slots.json";

/** 合集机位：顺序固定，编号即机位号。 */
export interface Slot {
  no: number;
  id: string;
}

export const SLOTS: Slot[] = slots as Slot[];

export function slotOf(id: string): Slot | undefined {
  return SLOTS.find((slot) => slot.id === id);
}

/** 按机位号排序；未知 id 排在最后，避免构建期手滑打乱首页。 */
export function orderMetas<T extends { id: string; no?: number }>(metas: T[]): T[] {
  return metas.slice().sort((a, b) => {
    const sa = slotOf(a.id);
    const sb = slotOf(b.id);
    const na = sa?.no ?? a.no ?? 99;
    const nb = sb?.no ?? b.no ?? 99;
    return na - nb;
  });
}

export interface MetaLike {
  id: string;
  no: number;
  title: string;
  tagline: string;
  duration: string;
  tags: string[];
  size: { w: number; h: number };
  hud: { key: string; label: string }[];
  scoreMode?: "high" | "low";
  bestLabel?: string;
  pad?: {
    dpad?: string;
    up?: string;
    down?: string;
    left?: string;
    right?: string;
    a?: { action?: string; label?: string };
    b?: { action?: string; label?: string };
    start?: boolean;
  };
  drawThumb?: unknown;
}

/** 契约校验：开发期把明显写错的 meta 打出来，构建期由脚本再查一遍。 */
export function validateMeta(meta: MetaLike): string[] {
  const problems: string[] = [];
  const slot = slotOf(meta.id);
  if (!slot) problems.push(`id "${meta.id}" 不在 slots.json 里`);
  else if (slot.no !== meta.no) problems.push(`${meta.id} 的 no=${meta.no}，应为 ${slot.no}`);
  if (!meta.title) problems.push(`${meta.id} 缺少 title`);
  if (!meta.tagline) problems.push(`${meta.id} 缺少 tagline`);
  if (!meta.duration) problems.push(`${meta.id} 缺少 duration`);
  if (!Array.isArray(meta.tags) || meta.tags.length < 1) problems.push(`${meta.id} 至少要有 1 个标签`);
  if (!meta.size || meta.size.w <= 0 || meta.size.h <= 0) problems.push(`${meta.id} 的 size 不合法`);
  if (!meta.hud || meta.hud.length < 1 || meta.hud.length > 3) problems.push(`${meta.id} 的 hud 需要 1–3 栏`);
  if (typeof meta.drawThumb !== "function") problems.push(`${meta.id} 缺少 drawThumb()`);
  if ((meta.scoreMode ?? "high") !== "high" && (meta.scoreMode ?? "high") !== "low") {
    problems.push(`${meta.id} 的 scoreMode 只能是 high / low`);
  }
  if (meta.pad) {
    const { pad } = meta;
    if (pad.dpad !== undefined && !["none", "lr", "four"].includes(pad.dpad)) {
      problems.push(`${meta.id} 的 pad.dpad 只能是 none / lr / four`);
    }
    for (const key of ["up", "down", "left", "right"] as const) {
      if (pad[key] !== undefined && !pad[key]) problems.push(`${meta.id} 的 pad.${key} 不能为空`);
    }
    for (const key of ["a", "b"] as const) {
      const button = pad[key];
      if (!button) continue;
      if (!button.action) problems.push(`${meta.id} 的 pad.${key}.action 不能为空`);
      if (!button.label || button.label.length > 6) {
        problems.push(`${meta.id} 的 pad.${key}.label 需要 1–6 个字`);
      }
    }
    if (pad.start !== undefined && typeof pad.start !== "boolean") {
      problems.push(`${meta.id} 的 pad.start 必须是 boolean`);
    }
  }
  return problems;
}
