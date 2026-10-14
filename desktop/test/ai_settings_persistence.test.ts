import assert from "node:assert/strict";
import test from "node:test";
import { API_MODELS, apiPresetForSaved, modelNameForPreset } from "../src/verticals/finance/lib/ai-models.ts";
import {
  LLM_KEY, LLM_SOURCE_KEY, aiUsable, clearUserLlm, loadUserLlm, readAiRuntime, readLlmSource, saveUserLlm, useServerLlm,
} from "../src/verticals/finance/lib/llmStore.ts";

/**
 * 一份忠实的内存 localStorage：**按 key 存、支持 removeItem**。
 *
 * 🔴 不要再用「getItem 无视 key、只回一个字符串」的简化桩。配置本体（`vr-llm`）与
 *    「这一端用哪份配置」的标记（`vr-llm-source`）现在是**两个键**，
 *    无视 key 的桩会让两边互相污染，测出来的行为不是真实行为。
 * ⚠️ 没实现 `removeItem` 的桩会直接抛 TypeError —— 那不是产品的问题，是桩缺了 API。
 */
function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

/** 装上桩，返回当前内容的只读视图。 */
function install(storage: Record<string, unknown>): void {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
}

test("自定义端点保存重读后保留来源、模型及密钥，预设不按模型名串台 (#48)", () => {
  install(memoryStorage());
  for (const [provider, model, preset] of [
    ["openai-compatible", "my-model", "custom"],
    ["openai-compatible", "gpt-4o", "custom"],
    ["openrouter", "my-model", "openai/gpt-4o"],
    ["deepseek", "deepseek-v4-pro", "deepseek-v4-pro"],
  ]) {
    const cfg = { provider, model, apiKey: "fixture-key", baseURL: "https://example.com/v1" };
    saveUserLlm(cfg);
    assert.deepEqual(loadUserLlm(), cfg);
    assert.equal(apiPresetForSaved(loadUserLlm()), preset);
    assert.deepEqual(loadUserLlm(), cfg, "显示预设不得覆盖实际模型或凭据");
  }
});

test("选「其它 OpenAI 兼容端点」不把 custom 当模型名填进去，其它预设照填自己的模型名", () => {
  assert.equal(modelNameForPreset("custom"), "");
  for (const m of API_MODELS.filter((x) => x.id !== "custom")) assert.equal(modelNameForPreset(m.id), m.id);
});

test("浏览器静默丢弃写入时保存必须报错，不显示成功", () => {
  // setItem 被静默丢弃：removeItem 与 getItem 都正常（真实隐私模式下就是这样）
  install({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  assert.throws(() => saveUserLlm({ provider: "openai-compatible", model: "test", apiKey: "fixture-key", baseURL: "https://example.com" }), /保存/);
});

test("v2 之前页面存的 OpenAI 预设(来源名 openai,一直是官方 API)按 openai-api 读出;打开页面不改写存储,其它来源原样", () => {
  const legacy = { provider: "openai", model: "gpt-4o", apiKey: "fixture-key", baseURL: "https://api.openai.com/v1" };
  for (const stored of [JSON.stringify(legacy), JSON.stringify({ schemaVersion: 2, modePreferenceVersion: 1, source: legacy, executionMode: "agent" })]) {
    let writes = 0;
    install({ getItem: (k: string) => (k === LLM_KEY ? stored : null), setItem: () => { writes += 1; }, removeItem: () => { writes += 1; } });
    const read = readAiRuntime();
    assert.equal(read.status, "ok");
    assert.deepEqual(read.config?.source, { ...legacy, provider: "openai-api" }, "只改来源名,模型、key、地址原样");
    assert.equal(apiPresetForSaved(read.config!.source), "gpt-5.4", "落到 OpenAI 官方 API 这组预设上");
    assert.equal(writes, 0, "只读不写:等用户下次保存才写回");
  }
  const other = { provider: "openai-compatible", model: "m", apiKey: "fixture-key", baseURL: "https://example.com/v1" };
  install(memoryStorage({ [LLM_KEY]: JSON.stringify(other) }));
  assert.deepEqual(readAiRuntime().config?.source, other);
});

/**
 * 下面四条守的是「服务端那份」这套机制的行为契约。
 * 它存在的理由：换手机/换浏览器就等于没配过，每个端都要重填一次 —— 单人自用的服务不该这样。
 * 后端本来就有「不传 llm 就用后台默认来源」的通道，页面只需要把决定权交出去。
 */
test("标记为 server 时本机视为「有 AI」：状态是 server、无需本地配置、界面判定为可用", () => {
  install(memoryStorage({ [LLM_SOURCE_KEY]: "server" }));
  const read = readAiRuntime();
  assert.equal(read.status, "server");
  assert.equal(read.config, null, "服务端那份不在浏览器里，config 为空是正常状态");
  assert.equal(loadUserLlm(), null);
  assert.equal(aiUsable(read.status), true, "界面必须认它是已接入，否则会劝用户去重新接入");
  assert.equal(readLlmSource(), "server");
});

test("保存本机那份会摘掉 server 标记 —— 否则用户填了没反应", () => {
  install(memoryStorage({ [LLM_SOURCE_KEY]: "server" }));
  const cfg = { provider: "deepseek", model: "deepseek-v4-pro", apiKey: "fixture-key", baseURL: "https://api.deepseek.com" };
  saveUserLlm(cfg);
  assert.equal(readLlmSource(), null, "标记留着会让读配置时继续走服务端那份，本机这份等于白填");
  assert.equal(readAiRuntime().status, "ok");
  assert.deepEqual(loadUserLlm(), cfg);
});

test("清除会写下「明确不要服务端那份」—— 否则清除在下次打开时自己失效，看起来就是清不掉", () => {
  install(memoryStorage({ [LLM_KEY]: JSON.stringify({ provider: "deepseek", model: "m", apiKey: "k", baseURL: "https://a.b" }) }));
  clearUserLlm();
  assert.equal(readLlmSource(), "none");
  assert.equal(readAiRuntime().status, "none", "本机没配 + 明确不要服务端 → 老实回到「请先接入 AI」");
  assert.equal(aiUsable(readAiRuntime().status), false);
});

test("改用服务端那份会清掉本机配置 —— 两份同时留着迟早对不上", () => {
  install(memoryStorage({ [LLM_KEY]: JSON.stringify({ provider: "deepseek", model: "m", apiKey: "k", baseURL: "https://a.b" }) }));
  useServerLlm();
  assert.equal(readAiRuntime().status, "server");
  assert.equal(loadUserLlm(), null);
});
