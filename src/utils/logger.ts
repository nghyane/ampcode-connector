/** Structured logging with route decision tracking. */

export type RouteDecision = "LOCAL_CLAUDE" | "LOCAL_CODEX" | "LOCAL_GEMINI" | "LOCAL_ANTIGRAVITY" | "AMP_UPSTREAM";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  route?: RouteDecision;
  provider?: string;
  model?: string;
  duration?: number;
  error?: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function format(entry: LogEntry): string {
  const { timestamp, level, message, route, provider, model, duration, error } = entry;

  let line = `${timestamp} [${level.toUpperCase().padEnd(5)}] ${message}`;
  if (route) line += ` route=${route}`;
  if (provider) line += ` provider=${provider}`;
  if (model) line += ` model=${model}`;
  if (duration !== undefined) line += ` duration=${duration}ms`;
  if (error) line += ` error=${error}`;

  return line;
}

type Meta = Partial<Omit<LogEntry, "timestamp" | "level" | "message">>;

function log(level: LogLevel, message: string, meta?: Meta): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const line = format(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, meta?: Meta) => log("debug", message, meta),
  info: (message: string, meta?: Meta) => log("info", message, meta),
  warn: (message: string, meta?: Meta) => log("warn", message, meta),
  error: (message: string, meta?: Meta) => log("error", message, meta),

  route(decision: RouteDecision, provider: string, model: string): void {
    log("info", "Route decision", { route: decision, provider, model });
  },
};
