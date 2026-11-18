/**
 * @arcade/core —— 像素街机引擎
 *
 * 分层：
 *   palette / util / store / dom   基础
 *   render/*                       画布、像素字、图标、缩放
 *   input/*                        指针、键盘、滑动
 *   audio                          合成音效
 *   ui/*                           HUD、弹窗、Toast
 *   fullscreen                     全屏 / 沉浸模式
 *   shell                         播放壳（游戏运行时）
 *   game                          游戏契约类型
 */

export * from "./palette";
export * from "./util";
export * from "./store";
export * from "./dom";
export * from "./loop";
export * from "./audio";
export * from "./fullscreen";
export * from "./game";
export * from "./shell";
export * from "./a11y";

export * from "./render/font";
export * from "./render/draw";
export * from "./render/pixel-text";
export * from "./render/icons";
export * from "./render/surface";

export * from "./input/pointer";
export * from "./input/keys";
export * from "./input/swipe";

export * from "./ui/hud";
export * from "./ui/overlay";
export * from "./ui/toast";
export * from "./ui/countdown";
