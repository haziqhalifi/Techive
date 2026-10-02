import "dotenv/config";

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function readBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  nodeEnv: readString("NODE_ENV", "development"),
  port: readInt("PORT", 8000),

  corsOrigins: readString("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  /** Deterministic seed for the synthetic world. */
  seed: readInt("HARVEST_SEED", 20261002),

  /**
   * The model's only job is to choose one pill ID. When disabled the pipeline runs with no
   * API key and falls back to a deterministic choice — which is how the demo and CI run.
   */
  llm: {
    enabled: readBool("LLM_ENABLED", false),
    apiKey: readString("OPENAI_API_KEY", ""),
    baseUrl: readString("OPENAI_BASE_URL", ""),
    model: readString("OPENAI_MODEL", "gpt-4o-mini"),
  },

  demoUserId: readString("DEMO_USER_ID", "11111111-1111-1111-1111-111111111111"),

  get isTest(): boolean {
    return this.nodeEnv === "test";
  },
} as const;

export type Config = typeof config;
