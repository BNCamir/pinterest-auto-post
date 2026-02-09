import "dotenv/config";
import { createServer } from "http";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { runPipeline } from "./workflow/orchestrator.js";

const PORT = Number(process.env.PORT) || 3000;

function startServer(): void {
  const server = createServer((req, res) => {
    const url = req.url?.split("?")[0] ?? "/";
    if (url === "/" || url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "boxncase-content-automation" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(PORT, () => {
    log("info", `Server listening on port ${PORT}`, { port: PORT });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  startServer();

  log("info", "BoxNCase content automation starting", {
    runMode: config.RUN_MODE,
    dryRun: config.DRY_RUN
  });
  runPipeline(config, new Date())
    .then(() => {
      log("info", "BoxNCase content automation finished");
    })
    .catch((err) => {
      log("error", err instanceof Error ? err.message : String(err), { stack: (err as Error).stack });
    });
}

main().catch((err) => {
  log("error", err instanceof Error ? err.message : String(err), { stack: (err as Error).stack });
  process.exit(1);
});
