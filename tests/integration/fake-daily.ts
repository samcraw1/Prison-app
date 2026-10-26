import { createServer, type Server } from "node:http";

export type Call = { method: string; path: string; body: unknown };

// Minimal stand-in for the Daily REST API, so the join/end routes can be tested without a real key.
export function startFakeDaily(port = 4999): Promise<{ server: Server; calls: Call[] }> {
  const calls: Call[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: req.method!, path: req.url!, body });
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/rooms") return res.end(JSON.stringify({ name: body.name, url: `https://fake.daily.test/${body.name}` }));
      if (req.method === "POST" && req.url === "/meeting-tokens") return res.end(JSON.stringify({ token: `fake-token-${calls.length}` }));
      if (req.method === "DELETE") return res.end("{}");
      res.statusCode = 404;
      res.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, calls })));
}
