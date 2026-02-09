export type LogLevel = "debug" | "info" | "warn" | "error";

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...meta
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}
