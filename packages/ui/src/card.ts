import { el } from "@arcade/core";

export interface CardGame {
  id: string;
  no: number;
  title: string;
  tagline: string;
  duration: string;
  open: boolean;
  best: number | null;
  bestLabel: string;
  scoreMode: "high" | "low";
}

const THUMB_W = 160;
const THUMB_H = 100;

/**
 * 游戏卡片：结构与旧版首页手写的 <li> 完全一致，
 * 样式全部来自 packages/styles/src/home.css。
 */
export function createCard(game: CardGame, index: number, href: string): HTMLLIElement {
  const li = el("li", { attrs: { style: `--i:${index}` } });

  if (!game.open) {
    li.append(
      el("div", {
        className: "game-card game-card--soon",
        children: [
          el("div", {
            className: "card-top",
            children: [
              el("canvas", {
                attrs: {
                  "data-thumb": "soon",
                  "data-seed": String(game.no),
                  width: String(THUMB_W),
                  height: String(THUMB_H),
                  "aria-hidden": "true",
                },
              }),
              el("span", { className: "card-no", text: `NO.${String(game.no).padStart(2, "0")}` }),
              el("span", { className: "chip", text: "敬请期待" }),
            ],
          }),
          el("div", {
            className: "card-body",
            children: [
              el("h3", { text: "敬请期待" }),
              el("p", { text: "空机位 · 正在打磨像素" }),
              el("div", {
                className: "card-foot",
                children: [
                  el("span", { className: "soon-label", text: "SOON" }),
                  el("span", { className: "soon-label", text: `#${String(game.no).padStart(2, "0")}` }),
                ],
              }),
            ],
          }),
        ],
      }),
    );
    return li;
  }

  const best = game.best ?? 0;
  const bestText =
    game.scoreMode === "low" ? (game.best === null ? "—" : String(best)) : String(best).padStart(5, "0");

  const bestNode = el("span", { className: "best" });
  bestNode.append(document.createTextNode(`${game.bestLabel} `));
  const bestValue = el("b", { text: bestText, attrs: { "data-best": game.id } });
  bestNode.append(bestValue);

  const link = el("a", {
    className: "game-card game-card--open",
    attrs: {
      href,
      "aria-label": `${game.title}，${game.tagline}，开始游戏`,
    },
    children: [
      el("div", {
        className: "card-top",
        children: [
          el("canvas", {
            attrs: {
              "data-thumb": game.id,
              width: String(THUMB_W),
              height: String(THUMB_H),
              "aria-hidden": "true",
            },
          }),
          el("span", { className: "card-no", text: `NO.${String(game.no).padStart(2, "0")}` }),
          el("span", { className: "chip chip--live", text: "可玩" }),
          el("span", { className: "play-glyph", attrs: { "aria-hidden": "true" } }),
        ],
      }),
      el("div", {
        className: "card-body",
        children: [
          el("h3", { text: game.title }),
          el("p", { text: game.tagline }),
          el("div", {
            className: "card-foot",
            children: [bestNode, el("span", { className: "go", text: "开始 →" })],
          }),
        ],
      }),
    ],
  });

  li.append(link);
  return li;
}
