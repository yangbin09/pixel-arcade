/**
 * 跨平台定位 Chrome/Chromium。CI（ubuntu-latest）自带 google-chrome，
 * 本地 Windows 默认用 D:\ruanjian\Chrome，找不到可以用 CHROME_PATH 覆盖。
 */
import { existsSync } from "node:fs";

const WINDOWS = [
  "D:\\ruanjian\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const LINUX = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/opt/google/chrome/chrome",
  "/snap/bin/chromium",
];

const MACOS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

export function findChrome() {
  const platform = process.platform;
  const candidates = [
    process.env.CHROME_PATH,
    ...(platform === "win32" ? WINDOWS : platform === "darwin" ? MACOS : LINUX),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

/** CI 容器/无特权环境需要的额外启动参数。 */
export function ciChromeArgs() {
  const isCi = process.env.CI === "true" || process.env.CI === "1";
  return isCi ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
}
