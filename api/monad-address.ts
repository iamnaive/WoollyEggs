import { kv } from "@vercel/kv";
import { BASE_SET } from "../src/lib/baseAddresses";

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

async function storeConfirmedAddress(address: string): Promise<boolean> {
  if (!hasKvConfig()) {
    return false;
  }

  const result = await kv.sadd("we:confirmed", address);
  return Number(result) > 0;
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
    const verified = BASE_SET.has(normalized);

    if (!verified) {
      res.status(200).json({ ok: true, verified: false });
      return;
    }

    const inserted = await storeConfirmedAddress(normalized);

    res.status(200).json({ ok: true, verified: true, inserted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected KV error";
    res.status(500).json({ ok: false, error: message });
  }
}
