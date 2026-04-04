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
    const resp = await fetch(`${BGG_API_BASE}/${listId}?comments=1`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!resp.ok) {
      throw new Error(`BGG API returned ${resp.status}`);
    }

    const text = await resp.text();

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

function parsePrice(item: any, body: string): number {
  const attrPrice = parseFloat(item["@_price"]);
  if (!isNaN(attrPrice) && attrPrice > 0) return attrPrice;

  const patterns = [
    /(?:BIN|FP):\[\/B\]\s*\$?([\d.]+)/i,
    /(?:BIN|FP):\s*\$?([\d.]+)/i,
    /\$\s*([\d.]+)/,
  ];
  for (const pat of patterns) {
    const m = body.match(pat);
    if (m) return parseFloat(m[1]);
  }
  return 0;
}

function parsePriceFromComment(text: string): number {
  const m = text.match(/\$\s*([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function parseBidAmount(text: string): number {
  // Match bid-related dollar amounts: "bid $15", "I'll bid $15", "$15", etc.
  const bidPattern = /bid\s+\$?\s*([\d.]+)/i;
  const dollarPattern = /\$\s*([\d.]+)/;
  const m = text.match(bidPattern) ?? text.match(dollarPattern);
  return m ? parseFloat(m[1]) : 0;
}

function isAuctionItem(body: string): boolean {
  return (
    /\[B\]SB:/i.test(body) ||
    /\bSB:\s*\$?\$?\d/i.test(body) ||
    /starting\s+bid/i.test(body)
  );
}

function parseCondition(body: string): string | undefined {
  const m =
    body.match(/Condition:\[\/B\]\s*([^\n\[]+)/i) ||
    body.match(/Condition:\s*([^\n\[]+)/i);
  if (m) return stripBBCode(m[1]).trim();
  return undefined;
}

function parseStatus(item: any, body: string): "listed" | "sold" | "withdrawn" {
  if (item["@_sold"] === "1" || item["@_sold"] === 1) return "sold";

  const lower = body.toLowerCase();
  if (
    lower.includes("sold to") ||
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
  const m = body.match(/[Ss][Oo][Ll][Dd]\s+to:?\s*.*?\[user=([^\]]+)\]/s);
  if (m) return m[1].trim();
  return undefined;
}

function parseType(body: string): "sale" | "purchase" {
  const lower = body.toLowerCase();
  if (
    lower.includes("wtb") ||
    lower.includes("want to buy") ||
    lower.includes("looking to buy") ||
    lower.includes("iso ") ||
    lower.includes("[wtb]")
  ) {
    return "purchase";
  }
  return "sale";
}

// Apostrophe variants: straight ('), curly right ('), curly left (')
const APO = "['\u2018\u2019]";

// Phrases in a comment that signal purchase intent
const PURCHASE_INTENT_RE = new RegExp(
  `\\bi${APO}?ll\\s+take\\s+(this|it|them|all|the\\s+lot)\\b|\\bmine\\b|\\bdibs\\b|\\bi\\s+will\\s+take\\s+(this|it|them)\\b`,
  "i"
);

// Phrases that explicitly cancel / withdraw interest
const CANCELLED_RE = new RegExp(
  `\\bi${APO}?(?:ll| will)\\s+pass\\b|\\bno\\s+longer\\s+interested\\b|\\bnevermind\\b|\\bnever\\s+mind\\b|\\bno\\s+thanks\\b|\\bi\\s+will\\s+pass\\b`,
  "i"
);

// Seller confirmation phrases in comments
const SELLER_CONFIRMED_RE = new RegExp(
  `\\bsold\\b|\\bsounds\\s+good\\b|\\bit${APO}?s?\\s+yours\\b|\\byou${APO}?re\\s+next\\b|\\byou\\s+got\\s+it\\b`,
  "i"
);

interface ParsedComment {
  username: string;
  text: string;
}

function getComments(item: any): ParsedComment[] {
  const raw = item.comment;
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((c: any) => ({
    username: (c["@_username"] ?? "").toLowerCase(),
    text: typeof c === "string" ? c : (c["#text"] ?? c._ ?? String(c)),
  }));
}

interface ParsedItem {
  id: string;
  gameTitle: string;
  price: number;
  type: "sale" | "purchase" | "auction";
  status: "listed" | "sold" | "withdrawn" | "expired";
  auctionStatus?: "winning" | "outbid";
  myBid?: number;
  buyerSeller?: string;
  condition?: string;
  notes?: string;
}

router.get("/bgg/geeklist", async (req, res) => {
  const { listId, username, apiToken, realName } = req.query as Record<string, string>;

  if (!listId || !username || !apiToken) {
    res.status(400).json({ error: "listId, username, and apiToken are required" });
    return;
  }

  try {
    const xml = await fetchGeelist(listId, apiToken);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      isArray: (name) => name === "item" || name === "comment",
    });
    const parsed = parser.parse(xml);

    const geeklist = parsed.geeklist;
    if (!geeklist) {
      res.status(502).json({ error: "Unexpected BGG API response format" });
      return;
    }

    const listTitle: string = geeklist.title ?? "BGG Geeklist";
    const rawItems: any[] = geeklist.item ?? [];
    const usernameLower = username.toLowerCase();
    const realNameLower = (realName ?? "").trim().toLowerCase();

    const items: ParsedItem[] = [];

    for (const item of rawItems) {
      const itemUsername: string = (item["@_username"] ?? "").toLowerCase();
      const body: string = item.body ?? "";
      const objectname: string = item["@_objectname"] ?? "Unknown Game";
      const comments = getComments(item);

      // ── Case 1: Items posted BY the user (their own sale listings) ──────────
      if (itemUsername === usernameLower) {
        const type = parseType(body);
        const status = parseStatus(item, body);
        const buyer = parseBuyer(body);

        items.push({
          id: String(item["@_id"] ?? Math.random()),
          gameTitle: objectname,
          price: parsePrice(item, body),
          type,
          status,
          buyerSeller: buyer,
          condition: parseCondition(body),
        });
        continue;
      }

      // ── Case 2: Auction items — check if user has placed a bid ───────────────
      if (isAuctionItem(body)) {
        const userBidComments = comments.filter(
          (c) => c.username === usernameLower && parseBidAmount(c.text) > 0
        );

        if (userBidComments.length > 0) {
          const myHighestBid = Math.max(...userBidComments.map((c) => parseBidAmount(c.text)));
          const otherBids = comments
            .filter((c) => c.username !== usernameLower)
            .map((c) => parseBidAmount(c.text))
            .filter((v) => v > 0);
          const highestOtherBid = otherBids.length > 0 ? Math.max(...otherBids) : 0;

          const auctionStatus: "winning" | "outbid" =
            myHighestBid >= highestOtherBid ? "winning" : "outbid";

          const isSold = item["@_sold"] === "1" || item["@_sold"] === 1;

          items.push({
            id: String(item["@_id"] ?? Math.random()),
            gameTitle: objectname,
            price: myHighestBid,
            type: "auction",
            status: isSold ? "sold" : "listed",
            auctionStatus,
            myBid: myHighestBid,
            buyerSeller: item["@_username"],
            condition: parseCondition(body),
          });
          continue;
        }
      }

      // ── Case 3: Items by others where the user appears as buyer ──────────────

      // 3a: BGG [user=] tag in body
      const userTagMatch = body.match(
        /[Ss][Oo][Ll][Dd]\s+to:?\s*.*?\[user=([^\]]+)\]/s
      );
      if (userTagMatch && userTagMatch[1].trim().toLowerCase() === usernameLower) {
        items.push({
          id: String(item["@_id"] ?? Math.random()),
          gameTitle: objectname,
          price: parsePrice(item, body),
          type: "purchase",
          status: "sold",
          buyerSeller: item["@_username"],
          condition: parseCondition(body),
        });
        continue;
      }

      // 3b: Seller typed the real name instead of a BGG tag
      if (
        realNameLower.length > 0 &&
        body.toLowerCase().includes("sold") &&
        body.toLowerCase().includes(realNameLower)
      ) {
        items.push({
          id: String(item["@_id"] ?? Math.random()),
          gameTitle: objectname,
          price: parsePrice(item, body),
          type: "purchase",
          status: "sold",
          buyerSeller: item["@_username"],
          condition: parseCondition(body),
        });
        continue;
      }

      // ── Case 4: Comments — user said "I'll take this" and wasn't cancelled ──
      const userComments = comments.filter((c) => c.username === usernameLower);
      if (userComments.length === 0) continue;

      const hasPurchaseIntent = userComments.some((c) =>
        PURCHASE_INTENT_RE.test(c.text)
      );
      if (!hasPurchaseIntent) continue;

      // Check if user explicitly cancelled after showing intent
      const lastUserComment = userComments[userComments.length - 1];
      if (CANCELLED_RE.test(lastUserComment.text)) continue;

      // Check for confirmation: sold attribute OR seller said "Sold" / "Sounds good"
      const isSoldByAttr =
        item["@_sold"] === "1" || item["@_sold"] === 1;
      const otherComments = comments.filter((c) => c.username !== usernameLower);
      const sellerConfirmed = otherComments.some((c) =>
        SELLER_CONFIRMED_RE.test(c.text)
      );

      if (!isSoldByAttr && !sellerConfirmed) continue;

      // Try to get price from the user's purchase-intent comment first
      const intentComment = userComments.find((c) => PURCHASE_INTENT_RE.test(c.text));
      const commentPrice = intentComment ? parsePriceFromComment(intentComment.text) : 0;
      const finalPrice = commentPrice > 0 ? commentPrice : parsePrice(item, body);

      items.push({
        id: String(item["@_id"] ?? Math.random()),
        gameTitle: objectname,
        price: finalPrice,
        type: "purchase",
        status: "sold",
        buyerSeller: item["@_username"],
        condition: parseCondition(body),
      });
    }

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
