/**
 * 用户的模型配置（**持久保存在当前浏览器 localStorage，不进仓库或后端配置**）+ 对话调用。
 *
 * 🔴 口径与开源版 Vibe-Research 对齐 —— 那一份经过真实用户验证：
 *    用户在「接入 AI」页选模型、粘自己的 key → 存本地 → **随请求发给本机后端** →
 *    后端把它拼进一个临时 env 交给引擎。**配置文件 / 日志 / 账本一个字节都碰不到。**
 *
 * ⚠️ 上一版的口径是「密钥只从环境变量读，界面只读」。那在终端里启动时没问题，
 *    但只依赖启动服务前配置 shell 环境，浏览器 UI 里就没有可操作的接入入口。
 *    「不进产品配置文件」这条纪律在新做法下照样成立。注意 localStorage 本身会由浏览器落到
 *    本机用户配置中，它不是系统钥匙串，也不承诺加密；这里只承诺不进入产品后端的持久化面。
 *
 * 🔴 浏览器产品只认**用户明确选定的**这一份配置，不会随手挑一家顶上。
 *    否则首次使用会在没做选择时悄悄调用另一家模型，界面也无法解释实际走了哪条路。
 *
 * ⚠️ 「明确选定」有两条合法的路，都由用户自己做主：
 *    ① 本机这份（浏览器里填、存本地）—— 它优先；
 *    ② 服务端那份（后端 `<数据根>/config.json` 的 `provider.profile`，**密钥不进浏览器**）——
 *       本机没填时才用它。为什么要有②：单人自用的部署里，换手机 / 换浏览器就等于没配过，
 *       每个端都要重填一次；而这是**一台机器一个人用**的服务。见 `adoptServerAiSource`。
 *    两条之外的第三种情况只有一种：**谁都没配** —— 那时老实报错，不编默认。
 */
import { ApiError, backend } from "./backend.ts";
import { parseHeadlineTranslations, type HeadlineTranslationInput } from "./headlineTranslation.ts";
import {
  aiUsable, clearUserLlm, loadUserLlm, readAiRuntime, readLlmSource, saveUserLlm, setLlmSource, useServerLlm,
  type LlmConfig,
} from "./llmStore.ts";
import { newAnalysisSession } from "./analysisSession.ts";

export type { LlmConfig };
export { readLlmSource, useServerLlm };
// ⚠️ 存取一律走 llmStore —— 这里再抄一份实现，迟早两边判定不一致
export { loadUserLlm };

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  /** 上游用它显示"AI 调了哪些数据工具"。我们的对话线程不联网、不调工具,恒为空 */
  trace: { tool: string; args: Record<string, unknown> }[];
  rounds: number;
}

export interface ChatHandlers {
  onDelta?: (text: string) => void;
  onTool?: (tool: string, args: Record<string, unknown>) => void;
}

export function saveLlm(cfg: LlmConfig): void {
  try {
    saveUserLlm(cfg);
  } catch (e) {
    // 🔴 存不下要**说出来**：静默失败会让用户以为配好了，下次打开又是空的
    throw new ApiError(`本地存储写不进去（${e instanceof Error ? e.message : String(e)}）—— 配置没保存`, 500, "storage_failed");
  }
}

export function clearLlm(): void {
  clearUserLlm();
}

/**
 * 页面这一端到底能不能用 AI：本机存了那份就用那份，本机没存则看服务端有没有默认来源。
 * 🔴 判定一律走 `aiUsable`，别在这里或页面里再写一遍 `status === "ok"`（见它上面的注释）。
 */
export function hasLlm(): boolean {
  return aiUsable(readAiRuntime().status);
}

/**
 * 启动时定一次「这一端用哪份配置」。**必须在挂载 React 之前 await 完**。
 *
 * 规则：
 *   · 用户已经表过态（`vr-llm-source` 有值）或本机已经存了一份 → 什么都不做。
 *   · 还没表态、本机也没存，而**服务端确实配了默认来源** → 记下 `"server"`。
 *   · 服务端也没配 → 什么都不做，页面照旧提示「请先接入 AI」（那是准确的）。
 *
 * 🔴 为什么要问服务端而不是"没配就报错"：单人自用的部署里，服务端那份就是这台机器的配置，
 *    各端打开即用才是对的；而**前端从不持有那份配置**，也无从替用户改口径 ——
 *    它唯一能做的是把「这次该用谁」交给后端（不传 `llm` 字段）。这个函数就是那件事的开关。
 * ⚠️ 先写标记再渲染，是为了避免首屏先闪一下「未接入 AI」再变回已接入。
 */
export async function adoptServerAiSource(): Promise<void> {
  if (readLlmSource() !== null) return;   // 用户表过态（server / none），不再自动改
  if (loadUserLlm()) return;              // 本机已经存了一份，它优先
  let profile: unknown;
  try {
    profile = (await backend.product()).provider?.profile;
  } catch {
    return;   // 后端连不上：这里不报错，后面读台账那一步会把真正的原因说清楚
  }
  if (typeof profile === "string" && profile.trim()) setLlmSource("server");
}

/** 兼容上游签名：上游的 `loadLlm()` 语义是"当前生效的配置"。 */
export function loadLlm(): LlmConfig | null {
  return loadUserLlm();
}

/**
 * 发一轮对话。
 * ⚠️ `context` 拼在问题前面 —— 上游用它把"当前这一页在看什么"带进去。
 * 每次页面分析使用新会话，只发最后一条用户消息与本次页面上下文；
 * 需要连续对话的入口使用 useAiChat 管理自己的会话，不调用本函数。
 */
export async function chatStream(
  messages: ChatMsg[],
  context: string,
  handlers: ChatHandlers = {},
  signal?: AbortSignal,
): Promise<ChatResult> {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) throw new ApiError("没有要问的内容", 400, "empty_message");
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const message = context ? `【当前页面的数据】\n${context}\n\n【问题】\n${last.content}` : last.content;
  // ⚠️ 用户那份由 `backend.chat` 自己带上（见 llmStore.ts 里那条"防线只守一个入口等于没有"）
  const r = await backend.chat(message, newAnalysisSession("page-analysis"), signal);
  // 用户中途关面板 / 换问题:结果照样回来了,但不往界面上写(与上游 abort 行为一致)
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const content = r.redacted
    ? `${r.reply}\n\n> ⚠️ 有 ${r.redacted} 行触发产出红线被移除(不给操作建议)。`
    : r.reply;
  handlers.onDelta?.(content);
  return { content, trace: [], rounds: 1 };
}

export function chat(messages: ChatMsg[], context: string): Promise<ChatResult> {
  return chatStream(messages, context);
}

/**
 * Investment News 的专用标题翻译。
 *
 * 不复用 `default` 对话会话：后端为每一批开独立线程，并把翻译规则放在
 * developer 指令层，RSS 标题只作为 JSON 数据进入用户层。
 */
export async function translateHeadlineBatch(
  items: HeadlineTranslationInput[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  if (!items.length) return new Map();
  const r = await backend.translateHeadlines(items, signal);
  // 后端已经逐条移除触发红线的译文；其余安全条目必须保留，不能因一条而丢整批。
  // 被移除的 id 自然缺席，页面会把那几条保留成英文并显示 partial。
  return parseHeadlineTranslations(JSON.stringify({ items: r.items }), items);
}
