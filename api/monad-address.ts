import { kv } from "@vercel/kv";

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

function parseAddress(req: ApiRequest): string {
  const body = req.body;
  if (!body) {
    return "";
  }

  if (typeof body === "object" && body !== null && "address" in body) {
    const value = (body as { address?: unknown }).address;
    return typeof value === "string" ? value.trim() : "";
  }

  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as { address?: unknown };
      return typeof parsed.address === "string" ? parsed.address.trim() : "";
    } catch {
      return "";
    }
  }

  return "";
}

function hasKvConfig(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    ""
  );
}

async function isAllowlisted(address: string): Promise<boolean> {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    return false;
  }

  try {
    const pgModule = await import("pg");
    const { Client } = pgModule.default ?? pgModule;
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const result = await client.query("SELECT 1 FROM allowlist_addresses WHERE address = $1 LIMIT 1", [address]);
      return (result.rowCount ?? 0) > 0;
    } finally {
      await client.end();
    }
  } catch {
    return false;
  }
}

async function storeConfirmedAddress(address: string): Promise<boolean> {
  if (!hasKvConfig()) {
    return false;
  }

  try {
    const result = await kv.sadd("we:confirmed", address);
    return Number(result) > 0;
  } catch {
    // Verification must not fail if confirmed-store is unavailable.
    return false;
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed. Use POST." });
    return;
  }

  const address = parseAddress(req);
  if (!ADDRESS_REGEX.test(address)) {
    res.status(400).json({ ok: false, error: "Invalid Monad EVM address format." });
    return;
  }

  try {
    const normalized = address.toLowerCase();
    const verified = await isAllowlisted(normalized);

    if (!verified) {
      res.status(400).json({ ok: false, error: "error", verified: false });
      return;
    }

    const inserted = await storeConfirmedAddress(normalized);

    res.status(200).json({ ok: true, verified: true, inserted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected KV error";
    res.status(500).json({ ok: false, error: message });
  }
}
