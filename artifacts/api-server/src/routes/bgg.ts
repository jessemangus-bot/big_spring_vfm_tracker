import { Router, type IRouter } from "express";
import { XMLParser } from "fast-xml-parser";

const router: IRouter = Router();

const BGG_API_BASE = "https://boardgamegeek.com/xmlapi/geeklist";
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGeelist(listId: string, apiToken: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const resp = await fetch(`${BGG_API_BASE}/${listId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!resp.ok) {
      throw new Error(`BGG API returned ${resp.status}`);
    }

    const text = await resp.text();

    // BGG queues requests and returns a message asking to retry
    if (text.includes("accepted and will be processed")) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    return text;
  }
  throw new Error("BGG API did not respond in time — please try again");
}

function stripBBCode(text: string): string {
  return text
    .replace(/\[\/?\w+(?:=.*?)?\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(body: string): number {
  // Match BIN: $XX or BIN: XX (with or without BBCode tags)
  const patterns = [
    /BIN:\[\/B\]\s*\$?([\d.]+)/i,
    /BIN:\s*\$?([\d.]+)/i,
    /\$\s*([\d.]+)/,
  ];
  for (const pat of patterns) {
    const m = body.match(pat);
    if (m) return parseFloat(m[1]);
  }
  return 0;
}

function parseCondition(body: string): string | undefined {
  const m = body.match(/Condition:\[\/B\]\s*([^\n\[]+)/i) ||
             body.match(/Condition:\s*([^\n\[]+)/i);
  if (m) return stripBBCode(m[1]).trim();
  return undefined;
}

function parseStatus(body: string): "listed" | "sold" | "withdrawn" {
  const lower = body.toLowerCase();
  if (
    lower.includes("sold to:") ||
    lower.includes("[sold]") ||
    lower.includes("sale complete") ||
    lower.includes("this item has been sold")
  ) {
    return "sold";
  }
  if (lower.includes("withdrawn") || lower.includes("no longer available")) {
    return "withdrawn";
  }
  return "listed";
}

function parseBuyer(body: string): string | undefined {
  const m = body.match(/[Ss]old to:.*?\[user=([^\]]+)\]/s);
  if (m) return m[1].trim();
  return undefined;
}

function parseType(body: string, objectname: string): "sale" | "purchase" {
  const text = (body + " " + objectname).toLowerCase();
  if (
    text.includes("wtb") ||
    text.includes("want to buy") ||
    text.includes("looking to buy") ||
    text.includes("iso ") ||
    text.includes("[wtb]")
  ) {
    return "purchase";
  }
  return "sale";
}

interface ParsedItem {
  id: string;
  gameTitle: string;
  price: number;
  type: "sale" | "purchase";
  status: "listed" | "sold" | "withdrawn" | "expired";
  buyerSeller?: string;
  condition?: string;
  notes?: string;
}

router.get("/bgg/geeklist", async (req, res) => {
  const { listId, username, apiToken } = req.query as Record<string, string>;

  if (!listId || !username || !apiToken) {
    res.status(400).json({ error: "listId, username, and apiToken are required" });
    return;
  }

  try {
    const xml = await fetchGeelist(listId, apiToken);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      isArray: (name) => name === "item",
    });
    const parsed = parser.parse(xml);

    const geeklist = parsed.geeklist;
    if (!geeklist) {
      res.status(502).json({ error: "Unexpected BGG API response format" });
      return;
    }

    const listTitle: string = geeklist.title ?? "BGG Geeklist";
    const rawItems = geeklist.item ?? [];

    const items: ParsedItem[] = rawItems
      .filter((item: any) => {
        const itemUsername: string = item["@_username"] ?? "";
        return itemUsername.toLowerCase() === username.toLowerCase();
      })
      .map((item: any) => {
        const body: string = item.body ?? "";
        const objectname: string = item["@_objectname"] ?? "Unknown Game";
        const type = parseType(body, objectname);
        const status = parseStatus(body);
        const buyer = parseBuyer(body);

        return {
          id: String(item["@_id"] ?? Math.random()),
          gameTitle: objectname,
          price: parsePrice(body),
          type,
          status: status as ParsedItem["status"],
          buyerSeller: buyer,
          condition: parseCondition(body),
          notes: undefined,
        };
      });

    res.json({
      listTitle,
      totalItems: rawItems.length,
      items,
    });
  } catch (err: any) {
    req.log.error({ err }, "BGG geeklist fetch failed");
    res.status(502).json({ error: err.message ?? "Failed to fetch geeklist" });
  }
});

export default router;
