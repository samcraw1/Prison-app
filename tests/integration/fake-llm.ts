import { createServer, type Server } from "node:http";

export type LlmCall = { path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown>; raw: string };

// Minimal stand-in for the Vercel AI Gateway language-model endpoint (the protocol @ai-sdk/gateway speaks:
// POST {baseURL}/language-model, streamed replies as SSE `data: <LanguageModelV4StreamPart>`). The app is pointed here
// with AI_API_BASE (npm run test:int sets it). Records every request so tests can check what was sent.
export function startFakeLlm(port = 4997): Promise<{ server: Server; calls: LlmCall[]; reply: { text: string; fail: boolean } }> {
  const calls: LlmCall[] = [];
  const reply = { text: "Staff review messages before they are delivered.", fail: false };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ path: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : {}, raw });
      if (req.method !== "POST" || req.url !== "/language-model") {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: { message: "not found", type: "not_found" } }));
      }
      if (reply.fail) {
        res.statusCode = 503;
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ error: { message: "no provider available", type: "no_providers_available" } }));
      }
      const usage = {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      };
      if (req.headers["ai-language-model-streaming"] === "true") {
        res.setHeader("content-type", "text/event-stream");
        const parts = [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: reply.text },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
        ];
        for (const p of parts) res.write(`data: ${JSON.stringify(p)}\n\n`);
        return res.end();
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ content: [{ type: "text", text: reply.text }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, calls, reply })));
}
