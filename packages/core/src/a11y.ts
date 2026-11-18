import { qs } from "./dom";

/** 读屏播报：写进 aria-live 区域，节制使用（一局只播关键节点）。 */
export function announce(message: string): void {
  let live = qs<HTMLElement>("#live");
  if (!live) {
    live = document.createElement("p");
    live.id = "live";
    live.className = "sr-only";
    live.setAttribute("aria-live", "polite");
    document.body.append(live);
  }
  live.textContent = "";
  window.setTimeout(() => {
    if (live) live.textContent = message;
  }, 30);
}

/** 可撤销的 aria-live 节点，给播放壳用。 */
export function createLiveRegion(): { el: HTMLElement; announce: (msg: string) => void; destroy: () => void } {
  const el = document.createElement("p");
  el.className = "sr-only";
  el.setAttribute("aria-live", "polite");
  document.body.append(el);
  let timer = 0;
  return {
    el,
    announce(msg: string) {
      window.clearTimeout(timer);
      el.textContent = "";
      timer = window.setTimeout(() => {
        el.textContent = msg;
      }, 30);
    },
    destroy() {
      window.clearTimeout(timer);
      el.remove();
    },
  };
}
