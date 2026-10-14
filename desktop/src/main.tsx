import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import "./index.css";
import { router } from "./verticals/finance/router";
import { hydrateNotes } from "./verticals/finance/lib/notes";
import { hydrateWatch } from "./verticals/finance/lib/watchlist";
import { adoptServerAiSource } from "./verticals/finance/lib/llm";

/**
 * **组装根**:唯一一处把垂类接进外壳的地方。
 *
 * 🔴 界面整套来自开源版 Vibe-Research(2026-08-20 `ab4ffa0`),原样搬入
 *    `src/verticals/finance/` —— 版式、导航、页面结构一律以那边为准,不再自己发挥。
 *    换个垂类 = 换这一行 import。
 * 🔴 **只有数据与密钥这一层改写**:上游把用户的 API key 存在浏览器 localStorage、
 *    每个请求带着走;我们的密钥只在后端环境变量里。改写集中在
 *    `verticals/finance/lib/{api,llm,agents,notes,watchlist}.ts` 与「接入 AI」页,其余一律照搬。
 */

document.title = "Vibe Research";

const root = document.getElementById("root");
if (!root) throw new Error("找不到 #root");

/**
 * 🔴 **先把台账灌进缓存,再挂载 React**。
 *    研究记录 / 自选在页面里是**同步读**的(`useState(loadNotes)`),
 *    挂载后才灌好的话首屏永远是空的,而且不会重渲染 —— 表现是"我的记录不见了"。
 * 🔴 灌不进去时**不要退化成空列表挂上去** —— 那会让"连不上后端"长得和"你没有记录"
 *    一模一样,用户还可能在上面新建、覆盖。宁可整页说清楚为什么。
 */
function fatal(message: string, detail: string) {
  root!.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText =
    "max-width:34rem;margin:18vh auto;padding:1.5rem;font:14px/1.7 system-ui,-apple-system,sans-serif;" +
    "color:#e5e7eb;background:#18181b;border:1px solid #3f3f46;border-radius:12px";
  const h = document.createElement("h1");
  h.textContent = message;
  h.style.cssText = "margin:0 0 .75rem;font-size:1.05rem;font-weight:600";
  const p = document.createElement("p");
  p.textContent = detail;
  p.style.cssText = "margin:0 0 1rem;color:#a1a1aa;white-space:pre-wrap";
  const tip = document.createElement("p");
  tip.textContent = "macOS / Linux 请运行 scripts/start；Windows 请运行 scripts\\start.cmd。";
  tip.style.cssText = "margin:0;color:#a1a1aa";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "重新连接";
  retry.style.cssText =
    "margin-top:1rem;padding:.55rem .85rem;color:#fff;background:#e4572e;border:0;border-radius:8px;cursor:pointer";
  retry.addEventListener("click", () => window.location.reload());
  box.append(h, p, tip, retry);
  root!.append(box);
}

/**
 * 🔴 `adoptServerAiSource()` 也在这条链上，而且**必须在渲染之前**：
 *    它决定「这一端用本机存的那份，还是用服务端自己的默认来源」。晚于首屏完成的话，
 *    界面会先按「未接入 AI」画一遍（首页弹接入框、每日复盘点不动），再跳回已接入。
 *    它自己吞掉网络错误，不会把启动拖垮 —— 真连不上后端时，下面读台账那一步会报得比它清楚。
 */
Promise.all([hydrateNotes(), hydrateWatch(), adoptServerAiSource()])
  .then(() => {
    createRoot(root).render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  })
  .catch((e: unknown) => {
    fatal("连不上后端,先不渲染界面", e instanceof Error ? e.message : String(e));
  });
