import { useEffect, useState } from "react";

import { AI_RUNTIME_CHANGED, LLM_KEY, LLM_SOURCE_KEY, readAiRuntime } from "@/lib/llmStore";

export function useAiRuntime() {
  const [runtime, setRuntime] = useState(() => readAiRuntime());
  useEffect(() => {
    const refresh = () => setRuntime(readAiRuntime());
    // 两个键都要听：配置本体与「这一端用哪份配置」的标记。
    // 只听 LLM_KEY 的话，在另一个标签页切到「用服务端配置」不会让这一页刷新 ——
    // 两个标签页显示不同的生效来源，而用户完全看不出哪个是真的。
    const storage = (event: StorageEvent) => { if (event.key === LLM_KEY || event.key === LLM_SOURCE_KEY) refresh(); };
    globalThis.addEventListener(AI_RUNTIME_CHANGED, refresh);
    globalThis.addEventListener("storage", storage);
    return () => {
      globalThis.removeEventListener(AI_RUNTIME_CHANGED, refresh);
      globalThis.removeEventListener("storage", storage);
    };
  }, []);
  return runtime;
}
