import { Store } from "./store";

export type InstallPlatform = "standalone" | "ios" | "ios-inapp" | "inapp" | "other";

/** 是否已经从主屏幕以独立应用方式打开。 */
export function isStandalone(): boolean {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** 是否 iPhone / iPod（iPad 支持元素全屏，不需要安装引导）。 */
export function isIPhone(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent);
}

/** 判断当前浏览器环境，决定安装引导的文案。 */
export function detectPlatform(): InstallPlatform {
  if (isStandalone()) return "standalone";
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const inApp = /MicroMessenger|QQ\/|QQBrowser|Weibo|AlipayClient|DingTalk|Lark|Feishu/i.test(ua);

  if (inApp) return ios ? "ios-inapp" : "inapp";
  if (ios) return "ios";
  return "other";
}

interface GuideCopy {
  kicker: string;
  title: string;
  lead: string;
  steps: string[];
  note: string;
}

function copyFor(platform: InstallPlatform): GuideCopy {
  if (platform === "ios") {
    return {
      kicker: "FULLSCREEN / iOS",
      title: "iPhone 上怎么真全屏",
      lead: "Safari 不允许网页隐藏地址栏。把本站添加到主屏幕，从桌面打开就没有地址栏和底栏。",
      steps: [
        "点浏览器工具栏的「分享」按钮",
        "在列表里选「添加到主屏幕」",
        "点「添加」，以后从桌面的 PIXEL ARCADE 打开",
      ],
      note: "主屏幕版是独立存档，最高分和 Safari 不互通。",
    };
  }
  if (platform === "ios-inapp" || platform === "inapp") {
    return {
      kicker: "FULLSCREEN / IN-APP",
      title: "在浏览器里打开才能全屏",
      lead: "当前是微信、QQ 等内置浏览器，不能添加到主屏幕，也隐藏不了底栏。",
      steps: [
        "点右上角的「···」",
        "选「在浏览器打开」",
        "在 Safari 里点「分享 → 添加到主屏幕」",
      ],
      note: "内置浏览器里可以继续玩，只是画面下方会一直有一条浏览器底栏。",
    };
  }
  return {
    kicker: "FULLSCREEN / TIP",
    title: "全屏提示",
    lead: "桌面浏览器按 F11，或点右上角的全屏按钮。",
    steps: ["按 F11 进入浏览器全屏", "再按一次 F11 退出"],
    note: "手机上的全屏说明只在 iOS 浏览器里显示。",
  };
}

/**
 * iPhone 的「添加到主屏幕」引导。
 *
 * iPhone Safari 不支持元素全屏，PWA 是唯一没有地址栏的方案；
 * 这个弹层只负责把步骤讲清楚，不能替用户点系统菜单。
 */
export class InstallGuide {
  private root: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private open = false;
  private lastFocus: HTMLElement | null = null;

  /** 第一次进游戏时自动弹；用户点了「不再提示」就不再自动弹。 */
  maybeShow(): boolean {
    const platform = detectPlatform();
    if (platform === "standalone" || platform === "other") return false;
    if (location.protocol === "file:") return false;
    if (Store.flag("pwa.tip", false)) return false;
    this.show(platform);
    return true;
  }

  /** 点全屏按钮时强制弹出，忽略「不再提示」。 */
  show(platform: InstallPlatform = detectPlatform()): void {
    if (platform === "standalone") return;
    this.ensure();
    const copy = copyFor(platform);
    const card = this.card;
    if (!card || !this.root) return;

    card.querySelector<HTMLElement>("[data-guide-kicker]")!.textContent = copy.kicker;
    card.querySelector<HTMLElement>("[data-guide-title]")!.textContent = copy.title;
    card.querySelector<HTMLElement>("[data-guide-lead]")!.textContent = copy.lead;
    card.querySelector<HTMLElement>("[data-guide-note]")!.textContent = copy.note;

    const list = card.querySelector<HTMLElement>("[data-guide-steps]")!;
    list.replaceChildren();
    copy.steps.forEach((step, index) => {
      const li = document.createElement("li");
      const num = document.createElement("span");
      num.className = "install-num";
      num.textContent = String(index + 1);
      const text = document.createElement("span");
      text.textContent = step;
      li.append(num, text);
      list.append(li);
    });

    if (this.open) return;
    this.open = true;
    this.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    document.body.classList.add("is-guide-open");
    requestAnimationFrame(() => {
      card.querySelector<HTMLElement>("[data-guide-close]")?.focus({ preventScroll: true });
    });
  }

  hide(markSeen = true): void {
    if (!this.open) return;
    this.open = false;
    if (this.root) this.root.hidden = true;
    document.body.classList.remove("is-guide-open");
    if (markSeen) Store.setFlag("pwa.tip", true);
    if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.focus({ preventScroll: true });
    this.lastFocus = null;
  }

  destroy(): void {
    this.hide(false);
    this.root?.remove();
    this.root = null;
    this.card = null;
  }

  private ensure(): void {
    if (this.root) return;
    const root = document.createElement("div");
    root.className = "install-guide";
    root.hidden = true;
    root.innerHTML = `
      <div class="install-backdrop" data-guide-close></div>
      <section class="install-card" role="dialog" aria-modal="true" aria-labelledby="installTitle">
        <p class="install-kicker" data-guide-kicker></p>
        <h2 id="installTitle" data-guide-title></h2>
        <p class="install-lead" data-guide-lead></p>
        <ol class="install-steps" data-guide-steps></ol>
        <p class="install-note" data-guide-note></p>
        <div class="install-actions">
          <button class="btn btn-primary" type="button" data-guide-close>知道了</button>
          <button class="btn-link" type="button" data-guide-never>不再提示</button>
        </div>
      </section>`;
    document.body.append(root);
    this.root = root;
    this.card = root.querySelector(".install-card");

    root.addEventListener("click", this.onClick);
    root.addEventListener("keydown", this.onKeyDown);
  }

  private onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-guide-never]")) {
      event.preventDefault();
      this.hide(true);
      return;
    }
    if (target.closest("[data-guide-close]")) {
      event.preventDefault();
      this.hide(true);
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.hide(true);
      return;
    }
    if (event.key !== "Tab" || !this.card) return;
    const focusable = Array.from(
      this.card.querySelectorAll<HTMLElement>("button:not([hidden]), a[href], [tabindex]:not([tabindex='-1'])"),
    );
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
