import { Router, type IRouter } from "express";
import { XMLParser } from "fast-xml-parser";

const router: IRouter = Router();

const BGG_API_BASE = "https://boardgamegeek.com/xmlapi/geeklist";
const BGG_COLLECTION_API_BASE = "https://boardgamegeek.com/xmlapi2/collection";
const BGG_API_TOKEN_ENV_VAR = "BGG_API_TOKEN";
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

async function fetchCollection(username: string, apiToken: string): Promise<string> {
  const params = new URLSearchParams({
    username,
    stats: "1",
  });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const resp = await fetch(`${BGG_COLLECTION_API_BASE}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!resp.ok) {
      throw new Error(`BGG collection API returned ${resp.status}`);
    }

    const text = await resp.text();

    if (text.includes("accepted and will be processed")) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    return text;
  }
  throw new Error("BGG collection API did not respond in time — please try again");
}

function attrIsTrue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

type WishlistMatchType = "wishlist" | "want_in_trade" | "want_to_buy";

function parseCollectionMatchMap(collectionXml: string): Map<string, WishlistMatchType[]> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "item",
  });
  const parsed = parser.parse(collectionXml);
  const rawItems: any[] = parsed.items?.item ?? [];
  const matchMap = new Map<string, WishlistMatchType[]>();

  for (const item of rawItems) {
    const objectId = String(item["@_objectid"] ?? "");
    if (!objectId) continue;

    const status = item.status ?? {};
    const matchTypes: WishlistMatchType[] = [];

    if (attrIsTrue(status["@_wishlist"])) matchTypes.push("wishlist");
    if (attrIsTrue(status["@_want"])) matchTypes.push("want_in_trade");
    if (attrIsTrue(status["@_wanttobuy"])) matchTypes.push("want_to_buy");

    if (matchTypes.length > 0) {
      matchMap.set(objectId, matchTypes);
    }
  }

  return matchMap;
}

function stripBBCode(text: string): string {
  return text
    .replace(/\[\/?\w+(?:=.*?)?\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function stripStruckThroughText(text: string): string {
  return text
    .replace(/\[(?:s|strike|del)\b[^\]]*][\s\S]*?\[\/(?:s|strike|del)\]/gi, " ")
    .replace(/<(?:s|strike|del)\b[^>]*>[\s\S]*?<\/(?:s|strike|del)>/gi, " ")
    .replace(
      /<span\b[^>]*text-decoration\s*:\s*line-through[^>]*>[\s\S]*?<\/span>/gi,
      " ",
    )
    .replace(/~~[^~]+~~/g, " ");
}

function parsePrice(item: any, body: string): number {
  const searchableBody = stripStruckThroughText(body);
  const hadStruckText = searchableBody !== body;
  const patterns = [
    /(?:BIN|FP):\[\/B\]\s*\$?([\d.]+)/i,
    /(?:BIN|FP):\s*\$?([\d.]+)/i,
    /\$\s*([\d.]+)/,
  ];
  for (const pat of patterns) {
    const m = searchableBody.match(pat);
    if (m) return parseFloat(m[1]);
  }

  // If the listing contains struck-through text, avoid stale @_price fallback.
  if (hadStruckText) return 0;

  const attrPrice = parseFloat(item["@_price"]);
  if (!isNaN(attrPrice) && attrPrice > 0) return attrPrice;

  return 0;
}

function parseBinPrice(body: string): number {
  const searchableBody = stripStruckThroughText(body);
  const m =
    searchableBody.match(/BIN:\[\/B\]\s*\$?\s*([\d.]+)/i) ??
    searchableBody.match(/\bBIN:\s*\$?\s*([\d.]+)/i);
  return m ? parseFloat(m[1]) : 0;
}

function parsePriceFromComment(text: unknown): number {
  const m = asText(text).match(/\$\s*([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function parseBidAmount(text: unknown): number {
  // Match bid-related dollar amounts: "bid $15", "I'll bid $15", "$15", etc.
  const bidPattern = /bid\s+\$?\s*([\d.]+)/i;
  const dollarPattern = /\$\s*([\d.]+)/;
  const normalized = asText(text);
  const m = normalized.match(bidPattern) ?? normalized.match(dollarPattern);
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
  `\\bi${APO}?ll\\s+take\\s+(this|it|them|all|the\\s+lot)\\b|\\bmine\\b|\\bdibs\\b|\\bi\\s+will\\s+take\\s+(this|it|them)\\b|\\bi\\s+offer\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\bmy\\s+offer\\s+is\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\bwould\\s+you\\s+take\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\bcan\\s+you\\s+do\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\bhow\\s+about\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b`,
  "i"
);

// Phrases that explicitly cancel / withdraw interest
const CANCELLED_RE = new RegExp(
  `\\bi${APO}?(?:ll|\\s*will|\\s*am\\s+(?:going\\s+to|gonna))\\s+pass\\b|\\bi\\s+have\\s+to\\s+pass\\b|\\bgoing\\s+to\\s+pass\\b|\\bno\\s+longer\\s+interested\\b|\\bnevermind\\b|\\bnever\\s+mind\\b|\\bno\\s+thanks\\b`,
  "i"
);

// Seller confirmation phrases in comments
const SELLER_CONFIRMED_RE = new RegExp(
  `\\bsold\\b|\\bsounds\\s+good\\b|\\bit${APO}?s?\\s+yours\\b|\\byou${APO}?re\\s+next\\b|\\byou\\s+got\\s+it\\b|\\boffer\\s+accepted\\b|\\baccepted\\b|\\bi\\s+accept\\b|\\bdeal\\b|\\bworks\\s+for\\s+me\\b`,
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
    text: asText(typeof c === "string" ? c : (c["#text"] ?? c._ ?? c)),
  }));
}

interface PurchaseIntentState {
  hasActiveIntent: boolean;
  latestIntentComment?: ParsedComment;
  hasCancellationSignal: boolean;
  latestSignal?: "intent" | "cancel";
}

function getPurchaseIntentState(
  comments: ParsedComment[],
  usernameLower: string
): PurchaseIntentState {
  let hasActiveIntent = false;
  let latestIntentComment: ParsedComment | undefined;
  let hasCancellationSignal = false;
  let latestSignal: "intent" | "cancel" | undefined;

  for (const comment of comments) {
    if (comment.username !== usernameLower) continue;

    const hasIntent = PURCHASE_INTENT_RE.test(comment.text);
    const hasCancelled = CANCELLED_RE.test(comment.text);

    if (hasIntent) {
      hasActiveIntent = true;
      latestIntentComment = comment;
      latestSignal = "intent";
    }

    // Cancellation in the same or later comment should override intent.
    if (hasCancelled) {
      hasActiveIntent = false;
      hasCancellationSignal = true;
      latestSignal = "cancel";
    }
  }

  return { hasActiveIntent, latestIntentComment, hasCancellationSignal, latestSignal };
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
  const { listId, username, realName } = req.query as Record<string, string>;

  if (!listId || !username) {
    res.status(400).json({ error: "listId and username are required" });
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
      const body: string = asText(item.body);
      const objectname: string = asText(item["@_objectname"] ?? "Unknown Game");
      const comments = getComments(item);
      const purchaseIntentState = getPurchaseIntentState(comments, usernameLower);

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
          const binPrice = parseBinPrice(body);
          const otherBids = comments
            .filter((c) => c.username !== usernameLower)
            .map((c) => parseBidAmount(c.text))
            .filter((v) => v > 0);
          const highestOtherBid = otherBids.length > 0 ? Math.max(...otherBids) : 0;

          const auctionStatus: "winning" | "outbid" =
            myHighestBid >= highestOtherBid ? "winning" : "outbid";

          const isSold = item["@_sold"] === "1" || item["@_sold"] === 1;
          const hasReachedBin = binPrice > 0 && myHighestBid >= binPrice;
          const shouldConvertToPurchase =
            hasReachedBin && auctionStatus === "winning";

          if (shouldConvertToPurchase) {
            items.push({
              id: String(item["@_id"] ?? Math.random()),
              gameTitle: objectname,
              price: binPrice,
              type: "purchase",
              status: "sold",
              buyerSeller: item["@_username"],
              condition: parseCondition(body),
            });
            continue;
          }

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

      // 3a: BGG [user=] tag in body must match username exactly.
      // If a sold-to username exists and is not this user, skip this item.
      const soldToUsername = parseBuyer(body)?.toLowerCase();
      if (soldToUsername) {
        if (soldToUsername !== usernameLower) continue;
        if (purchaseIntentState.latestSignal === "cancel") continue;
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
      // (only evaluated when no explicit sold-to username is present).
      if (
        realNameLower.length > 0 &&
        body.toLowerCase().includes("sold") &&
        body.toLowerCase().includes(realNameLower)
      ) {
        if (purchaseIntentState.latestSignal === "cancel") continue;
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
      if (!purchaseIntentState.hasActiveIntent) continue;

      // Check for confirmation: sold attribute OR seller said "Sold" / "Sounds good"
      const isSoldByAttr =
        item["@_sold"] === "1" || item["@_sold"] === 1;
      const sellerComments = comments.filter((c) => c.username === itemUsername);
      const sellerConfirmed = sellerComments.some((c) =>
        SELLER_CONFIRMED_RE.test(c.text)
      );

      if (!isSoldByAttr && !sellerConfirmed) continue;

      // Try to get price from the user's purchase-intent comment first
      const intentComment = purchaseIntentState.latestIntentComment;
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

router.get("/bgg/wishlist", async (req, res) => {
  const { listId, username } = req.query as Record<string, string>;

  if (!listId || !username) {
    res.status(400).json({ error: "listId and username are required" });
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
    const [geeklistXml, collectionXml] = await Promise.all([
      fetchGeelist(listId, apiToken),
      fetchCollection(username, apiToken),
    ]);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      isArray: (name) => name === "item" || name === "comment",
    });
    const parsed = parser.parse(geeklistXml);

    const geeklist = parsed.geeklist;
    if (!geeklist) {
      res.status(502).json({ error: "Unexpected BGG API response format" });
      return;
    }

    const listTitle: string = geeklist.title ?? "BGG Geeklist";
    const rawItems: any[] = geeklist.item ?? [];
    const matchMap = parseCollectionMatchMap(collectionXml);

    const items = rawItems
      .map((item) => {
        const body: string = asText(item.body);
        const status = parseStatus(item, body);
        const type = parseType(body);
        const objectId = String(item["@_objectid"] ?? "");
        const matchTypes = objectId ? matchMap.get(objectId) : undefined;

        if (!matchTypes || matchTypes.length === 0) return null;
        if (type !== "sale") return null;
        if (status !== "listed") return null;

        const itemId = String(item["@_id"] ?? Math.random());
        const gameTitle: string = item["@_objectname"] ?? "Unknown Game";
        const seller: string = item["@_username"] ?? "";

        return {
          id: itemId,
          objectId,
          gameTitle,
          price: parsePrice(item, body),
          seller,
          condition: parseCondition(body),
          matchTypes,
          bggUrl: `https://boardgamegeek.com/geeklist/${listId}/item/${itemId}`,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.gameTitle.localeCompare(b.gameTitle));

    res.json({
      listTitle,
      totalItems: rawItems.length,
      totalMatches: items.length,
      items,
    });
  } catch (err: any) {
    req.log.error({ err }, "BGG wishlist match fetch failed");
    res.status(502).json({ error: err.message ?? "Failed to fetch wishlist matches" });
  }
});

export default router;
