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

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed. Use POST." });
    return;
  }

  if (!hasKvConfig()) {
    res.status(500).json({
      ok: false,
      error:
        "Vercel KV is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel, then redeploy."
    });
    return;
  }

  const address = parseAddress(req);
  if (!ADDRESS_REGEX.test(address)) {
    res.status(400).json({ ok: false, error: "Invalid Monad EVM address format." });
    return;
  }

  try {
    const normalized = address.toLowerCase();
    const key = `monad:addr:${normalized}`;
    const now = Date.now().toString();

    const inserted = await kv.set(key, now, { nx: true });
    await kv.sadd("monad:addrs", normalized);

    res.status(200).json({ ok: true, inserted: Boolean(inserted) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected KV error";
    res.status(500).json({ ok: false, error: message });
  }
}
