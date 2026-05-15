import { Router, type IRouter } from "express";
import { XMLParser } from "fast-xml-parser";

const router: IRouter = Router();

const BGG_API_BASE = "https://boardgamegeek.com/xmlapi/geeklist";
const BGG_COLLECTION_API_BASE = "https://boardgamegeek.com/xmlapi2/collection";
const BGG_API_TOKEN_ENV_VAR = "BGG_API_TOKEN";
const RETRY_DELAY_MS = 3000;
const RETRY_DELAY_SECONDS = Math.ceil(RETRY_DELAY_MS / 1000);
const BGG_FETCH_TIMEOUT_MS = 5000;
const BGG_COMMENT_FETCH_TIMEOUT_MS = 15000;
const COMMENT_CACHE_TTL_MS = 60 * 60 * 1000;
const COMMENT_BACKGROUND_MAX_ATTEMPTS = 12;
const BGG_XML_ENTITY_EXPANSION_LIMIT = 250_000;
const BGG_XML_EXPANDED_LENGTH_LIMIT = 5 * 1024 * 1024;

class BggProcessingError extends Error {
  retryAfterSeconds = RETRY_DELAY_SECONDS;

  constructor(resource: string) {
    super(`${resource} is still being prepared by BGG. Please try again shortly.`);
    this.name = "BggProcessingError";
  }
}

async function fetchBggXmlText(
  url: string,
  apiToken: string,
  resource: string,
  errorPrefix: string,
  timeoutMs = BGG_FETCH_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`${errorPrefix} returned ${resp.status}`);
    }

    const text = await resp.text();

    if (text.includes("accepted and will be processed")) {
      throw new BggProcessingError(resource);
    }

    return text;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new BggProcessingError(resource);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGeelist(
  listId: string,
  apiToken: string,
  includeComments = false,
): Promise<string> {
  return fetchBggXmlText(
    `${BGG_API_BASE}/${listId}${includeComments ? "?comments=1" : ""}`,
    apiToken,
    includeComments ? "BGG geeklist comments" : "BGG geeklist",
    "BGG API",
    includeComments ? BGG_COMMENT_FETCH_TIMEOUT_MS : BGG_FETCH_TIMEOUT_MS,
  );
}

async function fetchCollection(username: string, apiToken: string): Promise<string> {
  const params = new URLSearchParams({
    username,
    stats: "1",
  });

  return fetchBggXmlText(
    `${BGG_COLLECTION_API_BASE}?${params.toString()}`,
    apiToken,
    "BGG collection",
    "BGG collection API",
  );
}

function attrIsTrue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

type WishlistMatchType = "wishlist" | "want_in_trade" | "want_to_buy";

function createBggXmlParser(arrayNodeNames: readonly string[]) {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: {
      enabled: true,
      maxTotalExpansions: BGG_XML_ENTITY_EXPANSION_LIMIT,
      maxExpandedLength: BGG_XML_EXPANDED_LENGTH_LIMIT,
    },
    isArray: (name: string) => arrayNodeNames.includes(name),
  });
}

function parseCollectionMatchMap(collectionXml: string): Map<string, WishlistMatchType[]> {
  const parser = createBggXmlParser(["item"]);
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const searchableText = stripStruckThroughText(asText(text));
  const m = searchableText.match(/\$\s*([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function parseBidAmount(text: unknown): number {
  // Match bid-related dollar amounts: "bid $15", "I'll bid $15", "$15", etc.
  const bidPattern = /bid(?:ding)?\s+\$?\s*([\d.]+)/i;
  const dollarPattern = /\$\s*([\d.]+)/;
  const bareAmountPattern = /^\s*(\d+(?:\.\d{1,2})?)\s*$/;
  const normalized = stripStruckThroughText(asText(text));
  const m =
    normalized.match(bidPattern) ??
    normalized.match(dollarPattern) ??
    normalized.match(bareAmountPattern);
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
    lower.includes("+sold+") ||
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

function extractSoldContext(body: string): string | undefined {
  const soldToMatch = body.match(/\bsold\s+to\b[\s:]*([\s\S]{0,360})/i);
  if (soldToMatch) return soldToMatch[1];

  const soldMatch = body.match(/\bsold\b[\s:]*([\s\S]{0,360})/i);
  if (soldMatch) return soldMatch[1];

  return undefined;
}

function parseBuyer(body: string): string | undefined {
  // Look near "sold"/"sold to" and support common BGG identity formats.
  const soldContext = extractSoldContext(body);
  if (!soldContext) return undefined;

  const userTagMatch = soldContext.match(/\[user=([^\]]+)\]/i);
  if (userTagMatch) return userTagMatch[1].trim();

  const atHandleMatch = soldContext.match(/@([a-z0-9][a-z0-9_-]{1,31})\b/i);
  if (atHandleMatch) return atHandleMatch[1].trim();

  const profileUrlMatch = soldContext.match(
    /boardgamegeek\.com\/(?:profile|user)\/([a-z0-9][a-z0-9_-]{1,31})\b/i,
  );
  if (profileUrlMatch) return profileUrlMatch[1].trim();

  return undefined;
}

function soldContextMentionsUsername(body: string, usernameLower: string): boolean {
  const soldContext = extractSoldContext(body);
  if (!soldContext) return false;

  const lowered = soldContext.toLowerCase();
  const escaped = usernameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return (
    new RegExp(`\\[user=${escaped}\\]`, "i").test(soldContext) ||
    new RegExp(`@${escaped}\\b`, "i").test(soldContext) ||
    new RegExp(`\\b${escaped}\\b`, "i").test(lowered) ||
    new RegExp(
      `boardgamegeek\\.com\\/(?:profile|user)\\/${escaped}\\b`,
      "i",
    ).test(soldContext)
  );
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
  `\\bi${APO}?ll\\s+take\\s+(this|it|them|all|the\\s+lot)\\b|\\bmine\\b|\\bdibs\\b|\\bi\\s+will\\s+take\\s+(this|it|them)\\b|\\bi\\s+offer\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\bmy\\s+offer\\s+is\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\boffering\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\bi${APO}?m\\s+offering\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\bi\\s+am\\s+offering\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\bwould\\s+you\\s+take\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\bcan\\s+you\\s+do\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b|\\bhow\\s+about\\s+\\$?\\s*\\d+(?:\\.\\d+)?\\b`,
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

interface ParsedGeeklistData {
  listTitle: string;
  totalItems: number;
  items: ParsedItem[];
}

type CommentEnrichmentStatus = "warming" | "refreshing" | "ready" | "error";

interface CommentCacheEntry {
  status: CommentEnrichmentStatus;
  xml?: string;
  updatedAt?: number;
  startedAt?: number;
  error?: string;
  promise?: Promise<void>;
}

const commentGeeklistCache = new Map<string, CommentCacheEntry>();

function parseGeeklistXml(
  xml: string,
  username: string,
  realName: string | undefined,
): ParsedGeeklistData {
  const parser = createBggXmlParser(["item", "comment"]);
  const parsed = parser.parse(xml);

  const geeklist = parsed.geeklist;
  if (!geeklist) {
    throw new Error("Unexpected BGG API response format");
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
          .filter((c) => c.username !== usernameLower && c.username !== itemUsername)
          .map((c) => parseBidAmount(c.text))
          .filter((v) => v > 0);
        const highestOtherBid = otherBids.length > 0 ? Math.max(...otherBids) : 0;
        const finalBuyer = parseBuyer(body)?.toLowerCase();
        const finalPrice = parsePrice(item, body);
        const status = parseStatus(item, body);

        const auctionStatus: "winning" | "outbid" =
          finalBuyer
            ? finalBuyer === usernameLower
              ? "winning"
              : "outbid"
            : (myHighestBid >= highestOtherBid ? "winning" : "outbid");

        const isSold = status === "sold";
        const hasReachedBin = binPrice > 0 && myHighestBid >= binPrice;
        const shouldConvertToPurchase =
          auctionStatus === "winning" && (hasReachedBin || finalBuyer === usernameLower);

        if (shouldConvertToPurchase) {
          items.push({
            id: String(item["@_id"] ?? Math.random()),
            gameTitle: objectname,
            price: finalPrice > 0 ? finalPrice : (binPrice > 0 ? binPrice : myHighestBid),
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

    // 3a: "Sold to" block explicitly names this user (tag, @handle, profile URL, or plain username).
    // If an explicit sold-to username exists and is not this user, skip this item.
    const soldToUsername = parseBuyer(body)?.toLowerCase();
    if (soldToUsername || soldContextMentionsUsername(body, usernameLower)) {
      if (soldToUsername && soldToUsername !== usernameLower) continue;
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
      extractSoldContext(body)?.toLowerCase().includes(realNameLower)
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
    if (!purchaseIntentState.hasActiveIntent) continue;

    // Check for confirmation: sold attribute OR seller said "Sold" / "Sounds good"
    const isSoldByAttr =
      item["@_sold"] === "1" || item["@_sold"] === 1;
    const isSoldByBody = parseStatus(item, body) === "sold";
    const sellerComments = comments.filter((c) => c.username === itemUsername);
    const sellerConfirmed = sellerComments.some((c) =>
      SELLER_CONFIRMED_RE.test(c.text)
    );

    if (!isSoldByAttr && !isSoldByBody && !sellerConfirmed) continue;

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

  return {
    listTitle,
    totalItems: rawItems.length,
    items,
  };
}

function mergeParsedItems(fastItems: ParsedItem[], enrichedItems: ParsedItem[]): ParsedItem[] {
  const byId = new Map<string, ParsedItem>();
  for (const item of fastItems) byId.set(item.id, item);
  for (const item of enrichedItems) byId.set(item.id, item);
  return Array.from(byId.values());
}

function ensureCommentGeeklistWarming(
  listId: string,
  apiToken: string,
  log: { warn: (...args: any[]) => void },
): CommentCacheEntry {
  const now = Date.now();
  const cacheKey = listId;
  const existing = commentGeeklistCache.get(cacheKey);
  const hasFreshXml =
    existing?.xml && existing.updatedAt && now - existing.updatedAt < COMMENT_CACHE_TTL_MS;

  if (existing?.promise || hasFreshXml) {
    return existing;
  }

  const entry: CommentCacheEntry =
    existing ?? {
      status: "warming",
    };
  entry.status = entry.xml ? "refreshing" : "warming";
  entry.startedAt = now;
  entry.error = undefined;

  entry.promise = (async () => {
    try {
      for (let attempt = 0; attempt < COMMENT_BACKGROUND_MAX_ATTEMPTS; attempt++) {
        try {
          const xml = await fetchGeelist(listId, apiToken, true);
          entry.xml = xml;
          entry.updatedAt = Date.now();
          entry.status = "ready";
          entry.error = undefined;
          return;
        } catch (err: any) {
          if (!(err instanceof BggProcessingError)) throw err;
          entry.error = err.message;
          if (attempt < COMMENT_BACKGROUND_MAX_ATTEMPTS - 1) {
            await sleep(RETRY_DELAY_MS);
          }
        }
      }
      entry.status = entry.xml ? "ready" : "error";
      entry.error = "BGG comments were still processing after background retries.";
    } catch (err: any) {
      entry.status = entry.xml ? "ready" : "error";
      entry.error = err?.message ?? "Failed to refresh BGG comments.";
      log.warn({ err }, "BGG comment enrichment failed");
    } finally {
      entry.promise = undefined;
    }
  })();

  commentGeeklistCache.set(cacheKey, entry);
  return entry;
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
    const fastData = parseGeeklistXml(xml, username, realName);
    const commentEntry = ensureCommentGeeklistWarming(listId, apiToken, req.log);

    let items = fastData.items;
    let commentEnrichmentStatus = commentEntry.status;
    let commentEnrichedAt = commentEntry.updatedAt
      ? new Date(commentEntry.updatedAt).toISOString()
      : null;
    let commentItems = 0;

    if (commentEntry.xml) {
      try {
        const enrichedData = parseGeeklistXml(commentEntry.xml, username, realName);
        commentItems = enrichedData.items.length;
        items = mergeParsedItems(fastData.items, enrichedData.items);
      } catch (err: any) {
        req.log.warn({ err }, "Cached BGG comment enrichment could not be parsed");
        commentEnrichmentStatus = "error";
      }
    }

    res.json({
      listTitle: fastData.listTitle,
      totalItems: fastData.totalItems,
      items,
      commentEnrichment: {
        status: commentEnrichmentStatus,
        enrichedAt: commentEnrichedAt,
        itemCount: commentItems,
        retryAfterSeconds: RETRY_DELAY_SECONDS,
      },
    });
  } catch (err: any) {
    if (err instanceof BggProcessingError) {
      res
        .status(202)
        .set("Retry-After", String(err.retryAfterSeconds))
        .json({
          error: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
        });
      return;
    }

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

    const parser = createBggXmlParser(["item", "comment"]);
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
    if (err instanceof BggProcessingError) {
      res
        .status(202)
        .set("Retry-After", String(err.retryAfterSeconds))
        .json({
          error: err.message,
          retryAfterSeconds: err.retryAfterSeconds,
        });
      return;
    }

    req.log.error({ err }, "BGG wishlist match fetch failed");
    res.status(502).json({ error: err.message ?? "Failed to fetch wishlist matches" });
  }
});

export default router;
