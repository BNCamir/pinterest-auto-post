import "dotenv/config";
import { createServer } from "http";
import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { runPipeline } from "./workflow/orchestrator.js";

const PORT = process.env.PORT !== undefined && process.env.PORT !== "" ? Number(process.env.PORT) : 3000;

let configError: string | null = null;

function startServer(): void {
  const server = createServer((req, res) => {
    const url = req.url?.split("?")[0] ?? "/";
    if (url === "/" || url === "/health") {
      if (configError) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            service: "boxncase-content-automation",
            error: "Invalid environment configuration",
            message: configError
          })
        );
        return;
      }
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
  startServer();

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
    log("error", configError, { hint: "Set variables in Railway (or .env). See .env.example" });
    return;
  }

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
