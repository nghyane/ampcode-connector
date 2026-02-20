/** YAML config loader with env/file fallback for API key. */

import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AMP_UPSTREAM_URL } from "../constants.ts";
import type { LogLevel } from "../utils/logger.ts";
import { logger } from "../utils/logger.ts";

export interface ProxyConfig {
  port: number;
  ampUpstreamUrl: string;
  ampApiKey?: string;
  exaApiKey?: string;
  logLevel: LogLevel;
  providers: {
    anthropic: boolean;
    codex: boolean;
    google: boolean;
  };
}

const DEFAULTS: ProxyConfig = {
  port: 8765,
  ampUpstreamUrl: DEFAULT_AMP_UPSTREAM_URL,
  logLevel: "info",
  providers: { anthropic: true, codex: true, google: true },
};

/** Config search order: cwd → ~/.config/ampcode-connector */
const CONFIG_PATHS = [
  join(process.cwd(), "config.yaml"),
  join(homedir(), ".config", "ampcode-connector", "config.yaml"),
];
const SECRETS_PATH = join(homedir(), ".local", "share", "amp", "secrets.json");

export async function loadConfig(): Promise<ProxyConfig> {
  const file = await readConfigFile();
  const apiKey = await resolveApiKey(file);
  const providers = asRecord(file?.providers);

  const port = asNumber(file?.port) ?? DEFAULTS.port;
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port ${port}: must be between 1 and 65535`);
  }

  return {
    port,
    ampUpstreamUrl: asString(file?.ampUpstreamUrl) ?? DEFAULTS.ampUpstreamUrl,
    ampApiKey: apiKey,
    exaApiKey: asString(file?.exaApiKey) ?? process.env.EXA_API_KEY,
    logLevel: asLogLevel(file?.logLevel) ?? DEFAULTS.logLevel,
    providers: {
      anthropic: asBool(providers?.anthropic) ?? DEFAULTS.providers.anthropic,
      codex: asBool(providers?.codex) ?? DEFAULTS.providers.codex,
      google: asBool(providers?.google) ?? DEFAULTS.providers.google,
    },
  };
}

async function readConfigFile(): Promise<Record<string, unknown> | null> {
  for (const configPath of CONFIG_PATHS) {
    const file = Bun.file(configPath);
    if (await file.exists()) {
      try {
        const text = await file.text();
        logger.info(`Loaded config from ${configPath}`);
        return Bun.YAML.parse(text) as Record<string, unknown>;
      } catch (err) {
        throw new Error(`Invalid config at ${configPath}: ${err}`);
      }
    }
  }
  return null;
}

/** Amp API key resolution: config file → AMP_API_KEY env → secrets.json */
async function resolveApiKey(file: Record<string, unknown> | null): Promise<string | undefined> {
  const fromFile = asString(file?.ampApiKey);
  if (fromFile) return fromFile;

  const fromEnv = process.env.AMP_API_KEY;
  if (fromEnv) return fromEnv;

  return readSecretsFile();
}

async function readSecretsFile(): Promise<string | undefined> {
  const file = Bun.file(SECRETS_PATH);
  if (!(await file.exists())) return undefined;
  try {
    const secrets = (await file.json()) as Record<string, unknown>;
    const canonical = asString(secrets[`apiKey@${DEFAULT_AMP_UPSTREAM_URL}/`]);
    if (canonical) return canonical;
    for (const value of Object.values(secrets)) {
      if (typeof value === "string" && value.startsWith("sgamp_")) return value;
    }
    return undefined;
  } catch (err) {
    logger.warn("Failed to read secrets.json", { error: String(err) });
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && !Number.isNaN(v) ? v : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

const VALID_LOG_LEVELS = new Set<string>(["debug", "info", "warn", "error"]);

function asLogLevel(v: unknown): LogLevel | undefined {
  return typeof v === "string" && VALID_LOG_LEVELS.has(v) ? (v as LogLevel) : undefined;
}
