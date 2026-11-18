import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KeyMap } from "../src/input/keys";

type Listener = (event: KeyboardEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const originalWindow = globalThis.window;
const originalHTMLElement = globalThis.HTMLElement;

beforeAll(() => {
  // KeyMap 只用到 addEventListener/removeEventListener；给 node 环境一个最小 window。
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener(type: string, fn: Listener) {
        const set = listeners.get(type) ?? new Set<Listener>();
        set.add(fn);
        listeners.set(type, set);
      },
      removeEventListener(type: string, fn: Listener) {
        listeners.get(type)?.delete(fn);
      },
    },
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: class HTMLElement {},
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: originalHTMLElement });
});

function key(type: "keydown" | "keyup", keyName: string): void {
  const event = {
    key: keyName,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    preventDefault() {},
  } as unknown as KeyboardEvent;
  for (const fn of listeners.get(type) ?? []) fn(event);
}

describe("KeyMap virtual pad", () => {
  it("press / release 成对触发，重复按下不重复派发", () => {
    const map = new KeyMap({ arrowleft: "left" });
    const log: string[] = [];
    map.onPress((action) => log.push(`+${action}`));
    map.onRelease((action) => log.push(`-${action}`));

    map.press("left");
    map.press("left");
    expect(map.isDown("left")).toBe(true);
    expect(log).toEqual(["+left"]);

    map.release("left");
    expect(map.isDown("left")).toBe(false);
    expect(log).toEqual(["+left", "-left"]);

    map.destroy();
  });

  it("键盘和手柄同时按住同一个动作时，只有全部松开才 release", () => {
    const map = new KeyMap({ arrowleft: "left" });
    const log: string[] = [];
    map.onPress((action) => log.push(`+${action}`));
    map.onRelease((action) => log.push(`-${action}`));

    key("keydown", "ArrowLeft");
    map.press("left");
    expect(log).toEqual(["+left"]);

    map.release("left");
    expect(map.isDown("left")).toBe(true);
    expect(log).toEqual(["+left"]);

    key("keyup", "ArrowLeft");
    expect(map.isDown("left")).toBe(false);
    expect(log).toEqual(["+left", "-left"]);

    map.destroy();
  });

  it("destroy 会移除键盘监听", () => {
    const before = listeners.get("keydown")?.size ?? 0;
    const map = new KeyMap({ enter: "action" });
    expect(listeners.get("keydown")?.size).toBe(before + 1);
    map.destroy();
    expect(listeners.get("keydown")?.size).toBe(before);
  });
});
