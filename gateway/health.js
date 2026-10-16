// Loopback-only health endpoint: GET /health returns the collector's state.
import http from "node:http";

export function startHealthServer(port, snapshot, { log } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      const body = JSON.stringify(snapshot(), null, 2);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });
  server.on("error", (err) => log?.error("health server error", { error: err.message }));
  server.listen(port, "127.0.0.1", () => log?.info("health endpoint ready", { url: `http://127.0.0.1:${port}/health` }));
  return server;
}
