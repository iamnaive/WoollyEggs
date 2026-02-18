import { sql } from "@vercel/postgres";

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

function getIp(req: ApiRequest): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0]?.trim() ?? "";
  }
  return "";
}

function getUserAgent(req: ApiRequest): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : "";
}

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

  if (!process.env.POSTGRES_URL && !process.env.POSTGRES_PRISMA_URL) {
    res.status(500).json({
      ok: false,
      error:
        "Vercel Postgres is not configured. Connect Postgres in your Vercel dashboard and redeploy."
    });
    return;
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS monad_addresses (
        id BIGSERIAL PRIMARY KEY,
        address TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        ip TEXT,
        user_agent TEXT
      )
    `;

    const ip = getIp(req);
    const userAgent = getUserAgent(req);

    const insertResult = await sql`
      INSERT INTO monad_addresses (address, ip, user_agent)
      VALUES (${address}, ${ip}, ${userAgent})
      ON CONFLICT (address) DO NOTHING
      RETURNING id
    `;

    res.status(200).json({ ok: true, inserted: insertResult.rowCount > 0 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected database error while saving address.";
    res.status(500).json({
      ok: false,
      error: message
    });
  }
}
