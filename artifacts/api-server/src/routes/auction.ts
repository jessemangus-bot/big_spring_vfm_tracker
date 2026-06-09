import { Router, type IRouter } from "express";
import { XMLParser } from "fast-xml-parser";

/**
 * Auction tracker routes.
 *
 * Unlike /bgg/geeklist (which reports items from one user's perspective),
 * this endpoint reports EVERY item in a geeklist auction with its current
 * high bid and high bidder — the auctioneer's view. Bids are free-text
 * comments, so parsing is heuristic; anything ambiguous is flagged rather
 * than silently trusted.
 *
 * Self-contained on purpose: shares no exports with bgg.ts so it can be
 * added/removed without touching existing behavior.
 */

const router: IRouter = Router();

const BGG_API_BASE = "https://boardgamegeek.com/xmlapi/geeklist";
const BGG_API_TOKEN_ENV_VAR = "BGG_API_TOKEN";
const RETRY_DELAY_SECONDS = 3;
const FETCH_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 60 * 1000;
const XML_ENTITY_EXPANSION_LIMIT = 250_000;
const XML_EXPANDED_LENGTH_LIMIT = 5 * 1024 * 1024;
const MAX_BIDS_RETURNED_PER_ITEM = 10;

class BggProcessingError extends Error {
  retryAfterSeconds = RETRY_DELAY_SECONDS;

  constructor() {
    super(
      "BGG is still preparing the geeklist comments. Please try again shortly.",
    );
    this.name = "BggProcessingError";
  }
}

interface CacheEntry {
  xml: string;
  fetchedAt: number;
}

const xmlCache = new Map<string, CacheEntry>();

async function fetchGeeklistWithComments(
  listId: string,
  apiToken: string,
): Promise<string> {
  const cached = xmlCache.get(listId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.xml;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(`${BGG_API_BASE}/${listId}?comments=1`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`BGG API returned ${resp.status}`);
    }

    const text = await resp.text();

    if (text.includes("accepted and will be processed")) {
      throw new BggProcessingError();
    }

    xmlCache.set(listId, { xml: text, fetchedAt: Date.now() });
    return text;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new BggProcessingError();
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Text helpers ───────────────────────────────────────────────────────────

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Sellers strike through superseded prices; struck text must not count. */
function stripStruckThroughText(text: string): string {
  return text
    .replace(/\[-\][\s\S]*?\[\/-\]/g, " ")
    .replace(/\[(?:s|strike|del)\b[^\]]*][\s\S]*?\[\/(?:s|strike|del)\]/gi, " ")
    .replace(/<(?:s|strike|del)\b[^>]*>[\s\S]*?<\/(?:s|strike|del)>/gi, " ")
    .replace(
      /<span\b[^>]*text-decoration\s*:\s*line-through[^>]*>[\s\S]*?<\/span>/gi,
      " ",
    )
    .replace(/~~[^~]+~~/g, " ");
}

function findFirstPrice(text: string, patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const price = parseFloat(match[1]);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return 0;
}

function parseStartingBid(body: string): number {
  return findFirstPrice(stripStruckThroughText(body), [
    /SB:\[\/B\]\s*\$?\s*([\d.]+)/i,
    /\bSB:?\s*\$?\s*([\d.]+)/i,
    /starting\s+bid[:\s]*\$?\s*([\d.]+)/i,
    /min(?:imum)?\s+bid[:\s]*\$?\s*([\d.]+)/i,
  ]);
}

function parseBinPrice(body: string): number {
  return findFirstPrice(stripStruckThroughText(body), [
    /BIN:\[\/B\]\s*\$?\s*([\d.]+)/i,
    /\bBIN:?\s*\$?\s*([\d.]+)/i,
    /buy\s*it\s*now[:\s]*\$?\s*([\d.]+)/i,
  ]);
}

// ── Bid parsing ────────────────────────────────────────────────────────────

interface ParsedBid {
  username: string;
  amount: number;
  isBin: boolean;
  flags: string[];
  raw: string;
}

const RETRACTION_RE =
  /\b(retract|withdraw|cancel(?:ling|led)?\s+my\s+bid|nevermind|never\s+mind)\b/i;

function parseBidFromComment(
  username: string,
  text: string,
): ParsedBid | null {
  const normalized = stripStruckThroughText(asText(text))
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (RETRACTION_RE.test(normalized)) return null;

  const isBin = /\b(bin|buy\s*it\s*now)\b/i.test(normalized);

  const moneyRe = /\$?\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)/g;
  const amounts = [...normalized.matchAll(moneyRe)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100000);

  if (amounts.length === 0) {
    // A bare "BIN" comment is a bid at the BIN price (resolved by caller).
    return isBin
      ? { username, amount: 0, isBin: true, flags: [], raw: normalized }
      : null;
  }

  const hasDollar = /\$/.test(normalized);
  const looksLikeBid =
    hasDollar ||
    isBin ||
    /\b(bid|i'?ll\s+(?:do|take|go)|offer)\b/i.test(normalized) ||
    /^\s*\d+(?:\.\d{1,2})?\s*$/.test(normalized);

  if (!looksLikeBid) return null;

  const amount = Math.max(...amounts);
  const flags: string[] = [];
  if (!hasDollar && !/^\s*\d+(?:\.\d{1,2})?\s*$/.test(normalized)) {
    flags.push("no $ sign — amount inferred from words");
  }
  if (amounts.length > 1) flags.push("multiple numbers in comment");
  if (/\bship|shipping|shipped\b/i.test(normalized) && !hasDollar) {
    flags.push("mentions shipping — figure may not be the bid");
  }

  return { username, amount, isBin, flags, raw: normalized };
}

// ── Endpoint ───────────────────────────────────────────────────────────────

interface AuctionItemResult {
  id: string;
  objectId?: string;
  gameTitle: string;
  seller: string;
  startingBid: number;
  binPrice: number;
  bidCount: number;
  highBid: {
    amount: number;
    username: string;
    viaBin: boolean;
    flags: string[];
    raw: string;
  } | null;
  yourStatus: "winning" | "outbid" | null;
  yourBest: number | null;
  bids: Array<{ username: string; amount: number }>;
  bggUrl: string;
}

router.get("/bgg/auction/bids", async (req, res) => {
  const { listId, username } = req.query as Record<string, string>;

  if (!listId) {
    res.status(400).json({ error: "listId is required" });
    return;
  }

  const apiToken = process.env[BGG_API_TOKEN_ENV_VAR]?.trim();
  if (!apiToken) {
    req.log.error(
      { envVar: BGG_API_TOKEN_ENV_VAR },
      "Missing required BGG API token configuration",
    );
    res.status(500).json({
      error: `Server is missing ${BGG_API_TOKEN_ENV_VAR} configuration`,
    });
    return;
  }

  try {
    const xml = await fetchGeeklistWithComments(listId, apiToken);
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      processEntities: {
        enabled: true,
        maxTotalExpansions: XML_ENTITY_EXPANSION_LIMIT,
        maxExpandedLength: XML_EXPANDED_LENGTH_LIMIT,
      },
      isArray: (name: string) => ["item", "comment"].includes(name),
    });
    const parsed = parser.parse(xml);

    const geeklist = parsed.geeklist;
    if (!geeklist) {
      res.status(502).json({ error: "Unexpected BGG API response format" });
      return;
    }

    const listTitle: string = asText(geeklist.title) || "BGG Geeklist";
    const rawItems: any[] = geeklist.item ?? [];
    const usernameLower = (username ?? "").trim().toLowerCase();

    const items: AuctionItemResult[] = rawItems.map((item) => {
      const itemId = String(item["@_id"] ?? "");
      const seller = asText(item["@_username"]);
      const sellerLower = seller.toLowerCase();
      const body = asText(item.body);
      const startingBid = parseStartingBid(body);
      const binPrice = parseBinPrice(body);

      const bids: ParsedBid[] = [];
      for (const c of asArray<any>(item.comment)) {
        const commentUser = asText(c["@_username"]);
        if (commentUser.toLowerCase() === sellerLower) continue;
        const text = typeof c === "string" ? c : (c["#text"] ?? c._ ?? c);
        const bid = parseBidFromComment(commentUser, text);
        if (bid) bids.push(bid);
      }

      // Resolve bare-BIN bids to the listed BIN price, then drop zeros.
      for (const bid of bids) {
        if (bid.isBin && bid.amount === 0 && binPrice > 0) {
          bid.amount = binPrice;
        }
      }
      const validBids = bids.filter((b) => b.amount > 0);

      // Winner: first BIN claim wins at BIN price; otherwise highest amount,
      // earliest comment winning ties (comments arrive in posted order).
      let winner: ParsedBid | null = null;
      const binClaim = validBids.find(
        (b) => b.isBin && binPrice > 0 && b.amount >= binPrice,
      );
      if (binClaim) {
        winner = binClaim;
      } else {
        for (const bid of validBids) {
          if (!winner || bid.amount > winner.amount) winner = bid;
        }
      }

      let yourStatus: "winning" | "outbid" | null = null;
      let yourBest: number | null = null;
      if (usernameLower) {
        const mine = validBids.filter(
          (b) => b.username.toLowerCase() === usernameLower,
        );
        if (mine.length > 0) {
          yourBest = Math.max(...mine.map((b) => b.amount));
          yourStatus =
            winner && winner.username.toLowerCase() === usernameLower
              ? "winning"
              : "outbid";
        }
      }

      const sortedBids = [...validBids].sort((a, b) => b.amount - a.amount);

      return {
        id: itemId,
        objectId: asText(item["@_objectid"]) || undefined,
        gameTitle: asText(item["@_objectname"] ?? "Unknown Game"),
        seller,
        startingBid,
        binPrice,
        bidCount: validBids.length,
        highBid: winner
          ? {
              amount: winner.amount,
              username: winner.username,
              viaBin: Boolean(binClaim),
              flags: winner.flags,
              raw: winner.raw,
            }
          : null,
        yourStatus,
        yourBest,
        bids: sortedBids
          .slice(0, MAX_BIDS_RETURNED_PER_ITEM)
          .map((b) => ({ username: b.username, amount: b.amount })),
        bggUrl: `https://boardgamegeek.com/geeklist/${listId}/item/${itemId}`,
      };
    });

    const withBids = items.filter((i) => i.highBid);

    res.json({
      listId,
      listTitle,
      totalItems: items.length,
      itemsWithBids: withBids.length,
      highBidTotal: withBids.reduce((s, i) => s + (i.highBid?.amount ?? 0), 0),
      yourWinning: usernameLower
        ? items.filter((i) => i.yourStatus === "winning").length
        : null,
      yourOutbid: usernameLower
        ? items.filter((i) => i.yourStatus === "outbid").length
        : null,
      items,
    });
  } catch (err: any) {
    if (err instanceof BggProcessingError) {
      res.status(202).set("Retry-After", String(err.retryAfterSeconds)).json({
        error: err.message,
        retryAfterSeconds: err.retryAfterSeconds,
      });
      return;
    }

    req.log.error({ err }, "BGG auction bids fetch failed");
    res
      .status(502)
      .json({ error: err.message ?? "Failed to fetch auction bids" });
  }
});

export default router;
