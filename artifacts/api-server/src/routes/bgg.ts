import { Router, type IRouter } from "express";
import { XMLParser } from "fast-xml-parser";

const router: IRouter = Router();

const BGG_API_BASE = "https://boardgamegeek.com/xmlapi/geeklist";
const BGG_COLLECTION_API_BASE = "https://boardgamegeek.com/xmlapi2/collection";
const BGG_THING_API_BASE = "https://boardgamegeek.com/xmlapi2/thing";
const BGG_API_TOKEN_ENV_VAR = "BGG_API_TOKEN";
const RETRY_DELAY_MS = 3000;
const RETRY_DELAY_SECONDS = Math.ceil(RETRY_DELAY_MS / 1000);
const BGG_FETCH_TIMEOUT_MS = 5000;
const BGG_THING_BATCH_TIMEOUT_MS = 30000;
const BGG_COMMENT_FETCH_TIMEOUT_MS = 15000;
const COMMENT_CACHE_TTL_MS = 60 * 60 * 1000;
const COMMENT_BACKGROUND_MAX_ATTEMPTS = 12;
const BGG_XML_ENTITY_EXPANSION_LIMIT = 250_000;
const BGG_XML_EXPANDED_LENGTH_LIMIT = 5 * 1024 * 1024;
const THING_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const THING_BATCH_CONCURRENCY = 3; // max parallel BGG thing API requests

interface ThingCacheEntry {
  categories: string[];
  mechanics: string[];
  minPlayers?: number;
  maxPlayers?: number;
  primaryName?: string;
  expansionBaseIds?: string[];
  cachedAt: number;
}

const thingCache = new Map<string, ThingCacheEntry>();

async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

class BggProcessingError extends Error {
  retryAfterSeconds = RETRY_DELAY_SECONDS;

  constructor(resource: string) {
    super(
      `${resource} is still being prepared by BGG. Please try again shortly.`,
    );
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

async function fetchCollection(
  username: string,
  apiToken: string,
): Promise<string> {
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

async function fetchForTradeCollection(
  username: string,
  apiToken: string,
): Promise<string> {
  const params = new URLSearchParams({
    username,
    stats: "1",
    trade: "1",
    version: "1",
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

function parseCollectionMatchMap(
  collectionXml: string,
): Map<string, WishlistMatchType[]> {
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

function getCollectionItemName(item: any): string {
  const name = asArray(item.name)[0];
  if (typeof name === "string") return name;
  if (name && typeof name === "object") {
    return asText(name["#text"] ?? name._ ?? name["@_value"]);
  }
  return "Unknown Game";
}

function getCollectionItemYear(item: any): number | undefined {
  const raw = item.yearpublished;
  const value =
    typeof raw === "object" && raw !== null
      ? Number(raw["#text"] ?? raw._ ?? raw["@_value"])
      : Number(raw);

  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function getVersionItem(item: any): any | undefined {
  return asArray(item.version?.item)[0];
}

function getCollectionVersionName(item: any): string | undefined {
  const versionItem = getVersionItem(item);
  if (!versionItem) return undefined;

  const primaryName = asArray(versionItem.name).find(
    (name: any) => name?.["@_type"] === "primary",
  );
  const fallbackName = asArray(versionItem.name)[0];
  const name = primaryName ?? fallbackName;
  const value = asText(name?.["@_value"] ?? name?.["#text"] ?? name);

  return value || undefined;
}

function getCollectionVersionLanguage(item: any): string | undefined {
  const versionItem = getVersionItem(item);
  if (!versionItem) return undefined;

  const languages = asArray(versionItem.link)
    .filter((link: any) => link?.["@_type"] === "language")
    .map((link: any) => asText(link?.["@_value"]))
    .filter(Boolean);

  return languages.length > 0 ? languages.join(", ") : undefined;
}

function parseForTradeCollectionItems(collectionXml: string) {
  const parser = createBggXmlParser(["item", "link", "name"]);
  const parsed = parser.parse(collectionXml);
  const rawItems: any[] = parsed.items?.item ?? [];

  return rawItems
    .filter((item) => attrIsTrue(item.status?.["@_fortrade"]))
    .map((item) => {
      const objectId = String(item["@_objectid"] ?? "");

      return {
        id: objectId || String(item["@_collid"] ?? Math.random()),
        collectionId: String(item["@_collid"] ?? ""),
        objectId,
        gameTitle: getCollectionItemName(item),
        yearPublished: getCollectionItemYear(item),
        version: getCollectionVersionName(item),
        language: getCollectionVersionLanguage(item),
        tradeCondition: asText(item.conditiontext) || undefined,
        thumbnail: asText(item.thumbnail) || undefined,
        image: asText(item.image) || undefined,
        bggUrl: objectId
          ? `https://boardgamegeek.com/boardgame/${objectId}`
          : undefined,
      };
    })
    .sort((a, b) =>
      a.gameTitle.localeCompare(b.gameTitle, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );
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
  if (typeof value === "object" && "#text" in (value as object)) {
    return String((value as any)["#text"]);
  }
  return String(value);
}

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

function findPrice(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const price = parseFloat(match[1]);
    if (Number.isFinite(price) && price > 0) return price;
  }

  return undefined;
}

function parsePriceFromText(text: string, patterns: RegExp[]): number {
  const textWithoutStrikes = stripStruckThroughText(text);
  const activePrice = findPrice(textWithoutStrikes, patterns);
  if (activePrice) return activePrice;

  const fallbackPrice =
    textWithoutStrikes === text ? undefined : findPrice(text, patterns);

  return fallbackPrice ?? 0;
}

function parsePrice(item: any, body: string): number {
  const patterns = [
    /(?:BIN|FP):\[\/B\]\s*\$?([\d.]+)/i,
    /(?:BIN|FP):\s*\$?([\d.]+)/i,
    /\$\s*([\d.]+)/,
  ];
  const bodyPrice = parsePriceFromText(body, patterns);
  if (bodyPrice > 0) return bodyPrice;

  const attrPrice = parseFloat(item["@_price"]);
  if (Number.isFinite(attrPrice) && attrPrice > 0) return attrPrice;

  return 0;
}

function parseBinPrice(body: string): number {
  return parsePriceFromText(body, [
    /BIN:\[\/B\]\s*\$?\s*([\d.]+)/i,
    /\bBIN:\s*\$?\s*([\d.]+)/i,
  ]);
}

function parsePriceFromComment(text: unknown): number {
  return parsePriceFromText(asText(text), [/\$\s*([\d.]+)/]);
}

function parseBidAmount(text: unknown): number {
  const normalized = stripStruckThroughText(asText(text));
  // Explicit bid keyword: "bid $15", "bidding 20", etc.
  const bidPattern = /bid(?:ding)?\s+\$?\s*([\d.]+)/i;
  // Dollar sign NOT preceded by a digit (avoids "7$ 49221" parsing as 49221).
  // Also exclude 5-digit matches (ZIP codes).
  const dollarPattern = /(?<!\d)\$\s*(\d+\.\d{1,2}|\d{1,4}|\d{6,})/;
  // Any bare number that is NOT exactly 5 digits (5-digit = ZIP code).
  const bareNumberPattern = /\b(\d+\.\d{1,2}|\d{1,4}|\d{6,})\b/;
  const m =
    normalized.match(bidPattern) ??
    normalized.match(dollarPattern) ??
    normalized.match(bareNumberPattern);
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

function soldContextMentionsUsername(
  body: string,
  usernameLower: string,
): boolean {
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
  "i",
);

// Phrases that explicitly cancel / withdraw interest
const CANCELLED_RE = new RegExp(
  `\\bi${APO}?(?:ll|\\s*will|\\s*am\\s+(?:going\\s+to|gonna))\\s+pass\\b|\\bi\\s+have\\s+to\\s+pass\\b|\\bgoing\\s+to\\s+pass\\b|\\bno\\s+longer\\s+interested\\b|\\bnevermind\\b|\\bnever\\s+mind\\b|\\bno\\s+thanks\\b`,
  "i",
);

// Seller confirmation phrases in comments
const SELLER_CONFIRMED_RE = new RegExp(
  `\\bsold\\b|\\bsounds\\s+good\\b|\\bit${APO}?s?\\s+yours\\b|\\byou${APO}?re\\s+next\\b|\\byou\\s+got\\s+it\\b|\\boffer\\s+accepted\\b|\\baccepted\\b|\\bi\\s+accept\\b|\\bdeal\\b|\\bworks\\s+for\\s+me\\b`,
  "i",
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
  usernameLower: string,
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

  return {
    hasActiveIntent,
    latestIntentComment,
    hasCancellationSignal,
    latestSignal,
  };
}

interface ParsedItem {
  id: string;
  gameTitle: string;
  price: number;
  type: "sale" | "purchase" | "offer" | "auction";
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

type VfmItemRelationship =
  | "mine"
  | "purchased"
  | "offer"
  | "auction"
  | "unrelated";

interface ParsedVfmItem {
  id: string;
  objectId?: string;
  gameTitle: string;
  price: number;
  seller: string;
  status: "listed" | "sold" | "withdrawn" | "expired";
  type: "sale" | "purchase";
  condition?: string;
  relationship: VfmItemRelationship;
  bggUrl: string;
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
      const listedPrice = parsePrice(item, body);

      // For auction listings, use the highest bid from comments as the price
      // rather than the body's SB/BIN value.
      let auctionPrice = 0;
      let highBidder: string | undefined;
      if (isAuctionItem(body)) {
        // Group bids by bidder and take each bidder's maximum bid
        const bidsByUser = new Map<string, number>();
        for (const c of comments) {
          if (c.username === usernameLower) continue;
          const bid = parseBidAmount(c.text);
          if (bid > 0) {
            const prev = bidsByUser.get(c.username) ?? 0;
            if (bid > prev) bidsByUser.set(c.username, bid);
          }
        }
        for (const [bidder, bid] of bidsByUser) {
          if (bid > auctionPrice) {
            auctionPrice = bid;
            highBidder = bidder;
          }
        }
      }

      const price = auctionPrice > 0 ? auctionPrice : listedPrice;
      const buyerSeller = buyer ?? highBidder;

      items.push({
        id: String(item["@_id"] ?? Math.random()),
        gameTitle: objectname,
        price,
        type,
        status,
        buyerSeller,
        condition: parseCondition(body),
      });
      continue;
    }

    // ── Case 2: Auction items — check if user has placed a bid ───────────────
    if (isAuctionItem(body)) {
      const userBidComments = comments.filter(
        (c) => c.username === usernameLower && parseBidAmount(c.text) > 0,
      );

      if (userBidComments.length > 0) {
        const myHighestBid = Math.max(
          ...userBidComments.map((c) => parseBidAmount(c.text)),
        );
        const binPrice = parseBinPrice(body);
        const otherBids = comments
          .filter(
            (c) => c.username !== usernameLower && c.username !== itemUsername,
          )
          .map((c) => parseBidAmount(c.text))
          .filter((v) => v > 0);
        const highestOtherBid =
          otherBids.length > 0 ? Math.max(...otherBids) : 0;
        const finalBuyer = parseBuyer(body)?.toLowerCase();
        const finalPrice = parsePrice(item, body);
        const status = parseStatus(item, body);

        const auctionStatus: "winning" | "outbid" = finalBuyer
          ? finalBuyer === usernameLower
            ? "winning"
            : "outbid"
          : myHighestBid >= highestOtherBid
            ? "winning"
            : "outbid";

        const isSold = status === "sold";
        const hasReachedBin = binPrice > 0 && myHighestBid >= binPrice;
        const shouldConvertToPurchase =
          auctionStatus === "winning" &&
          (hasReachedBin || finalBuyer === usernameLower);

        if (shouldConvertToPurchase) {
          items.push({
            id: String(item["@_id"] ?? Math.random()),
            gameTitle: objectname,
            price:
              finalPrice > 0
                ? finalPrice
                : binPrice > 0
                  ? binPrice
                  : myHighestBid,
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
    const isSoldByAttr = item["@_sold"] === "1" || item["@_sold"] === 1;
    const isSoldByBody = parseStatus(item, body) === "sold";
    const sellerComments = comments.filter((c) => c.username === itemUsername);
    const sellerConfirmed = sellerComments.some((c) =>
      SELLER_CONFIRMED_RE.test(c.text),
    );

    // Try to get price from the user's purchase-intent comment first
    const intentComment = purchaseIntentState.latestIntentComment;
    const commentPrice = intentComment
      ? parsePriceFromComment(intentComment.text)
      : 0;
    const finalPrice = commentPrice > 0 ? commentPrice : parsePrice(item, body);
    const isConfirmed = isSoldByAttr || isSoldByBody || sellerConfirmed;

    items.push({
      id: String(item["@_id"] ?? Math.random()),
      gameTitle: objectname,
      price: finalPrice,
      type: isConfirmed ? "purchase" : "offer",
      status: isConfirmed ? "sold" : "listed",
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

function mergeParsedItems(
  fastItems: ParsedItem[],
  enrichedItems: ParsedItem[],
): ParsedItem[] {
  const byId = new Map<string, ParsedItem>();
  for (const item of fastItems) byId.set(item.id, item);
  for (const item of enrichedItems) byId.set(item.id, item);
  return Array.from(byId.values());
}

function relationshipForParsedItem(item: ParsedItem): VfmItemRelationship {
  if (item.type === "purchase") return "purchased";
  if (item.type === "offer") return "offer";
  if (item.type === "auction") return "auction";
  return "mine";
}

function parseAllGeeklistItems(
  xml: string,
  listId: string,
  relatedItems: ParsedItem[],
): { listTitle: string; totalItems: number; items: ParsedVfmItem[] } {
  const parser = createBggXmlParser(["item"]);
  const parsed = parser.parse(xml);

  const geeklist = parsed.geeklist;
  if (!geeklist) {
    throw new Error("Unexpected BGG API response format");
  }

  const relatedById = new Map(
    relatedItems.map((item) => [item.id, relationshipForParsedItem(item)]),
  );
  const listTitle: string = geeklist.title ?? "BGG Geeklist";
  const rawItems: any[] = geeklist.item ?? [];

  const items = rawItems
    .map((item): ParsedVfmItem => {
      const id = String(item["@_id"] ?? Math.random());
      const body = asText(item.body);

      return {
        id,
        objectId: asText(item["@_objectid"]) || undefined,
        gameTitle: asText(item["@_objectname"] ?? "Unknown Game"),
        price: parsePrice(item, body),
        seller: asText(item["@_username"]),
        status: parseStatus(item, body),
        type: parseType(body),
        condition: parseCondition(body),
        relationship: relatedById.get(id) ?? "unrelated",
        bggUrl: `https://boardgamegeek.com/geeklist/${listId}/item/${id}`,
      };
    })
    .sort((a, b) => {
      const titleCmp = a.gameTitle.localeCompare(b.gameTitle, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (titleCmp !== 0) return titleCmp;

      return a.seller.localeCompare(b.seller, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });

  return {
    listTitle,
    totalItems: rawItems.length,
    items,
  };
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
    existing?.xml &&
    existing.updatedAt &&
    now - existing.updatedAt < COMMENT_CACHE_TTL_MS;

  if (existing?.promise || hasFreshXml) {
    return existing;
  }

  const entry: CommentCacheEntry = existing ?? {
    status: "warming",
  };
  entry.status = entry.xml ? "refreshing" : "warming";
  entry.startedAt = now;
  entry.error = undefined;

  entry.promise = (async () => {
    try {
      for (
        let attempt = 0;
        attempt < COMMENT_BACKGROUND_MAX_ATTEMPTS;
        attempt++
      ) {
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
      entry.error =
        "BGG comments were still processing after background retries.";
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
    const commentEntry = ensureCommentGeeklistWarming(
      listId,
      apiToken,
      req.log,
    );

    let items = fastData.items;
    let commentEnrichmentStatus = commentEntry.status;
    let commentEnrichedAt = commentEntry.updatedAt
      ? new Date(commentEntry.updatedAt).toISOString()
      : null;
    let commentItems = 0;

    if (commentEntry.xml) {
      try {
        const enrichedData = parseGeeklistXml(
          commentEntry.xml,
          username,
          realName,
        );
        commentItems = enrichedData.items.length;
        items = mergeParsedItems(fastData.items, enrichedData.items);
      } catch (err: any) {
        req.log.warn(
          { err },
          "Cached BGG comment enrichment could not be parsed",
        );
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
      res.status(202).set("Retry-After", String(err.retryAfterSeconds)).json({
        error: err.message,
        retryAfterSeconds: err.retryAfterSeconds,
      });
      return;
    }

    req.log.error({ err }, "BGG geeklist fetch failed");
    res.status(502).json({ error: err.message ?? "Failed to fetch geeklist" });
  }
});

router.get("/bgg/geeklist/all-items", async (req, res) => {
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
    const commentEntry = ensureCommentGeeklistWarming(
      listId,
      apiToken,
      req.log,
    );

    let relatedItems = fastData.items;
    let commentEnrichmentStatus = commentEntry.status;
    let commentEnrichedAt = commentEntry.updatedAt
      ? new Date(commentEntry.updatedAt).toISOString()
      : null;
    let commentItems = 0;

    if (commentEntry.xml) {
      try {
        const enrichedData = parseGeeklistXml(
          commentEntry.xml,
          username,
          realName,
        );
        commentItems = enrichedData.items.length;
        relatedItems = mergeParsedItems(fastData.items, enrichedData.items);
      } catch (err: any) {
        req.log.warn(
          { err },
          "Cached BGG comment enrichment could not be parsed",
        );
        commentEnrichmentStatus = "error";
      }
    }

    const data = parseAllGeeklistItems(xml, listId, relatedItems);
    const relationshipCounts = data.items.reduce(
      (counts, item) => {
        counts[item.relationship] += 1;
        return counts;
      },
      {
        mine: 0,
        purchased: 0,
        offer: 0,
        auction: 0,
        unrelated: 0,
      } satisfies Record<VfmItemRelationship, number>,
    );

    res.json({
      ...data,
      relationshipCounts,
      commentEnrichment: {
        status: commentEnrichmentStatus,
        enrichedAt: commentEnrichedAt,
        itemCount: commentItems,
        retryAfterSeconds: RETRY_DELAY_SECONDS,
      },
    });
  } catch (err: any) {
    if (err instanceof BggProcessingError) {
      res.status(202).set("Retry-After", String(err.retryAfterSeconds)).json({
        error: err.message,
        retryAfterSeconds: err.retryAfterSeconds,
      });
      return;
    }

    req.log.error({ err }, "BGG all geeklist items fetch failed");
    res
      .status(502)
      .json({ error: err.message ?? "Failed to fetch geeklist items" });
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
      res.status(202).set("Retry-After", String(err.retryAfterSeconds)).json({
        error: err.message,
        retryAfterSeconds: err.retryAfterSeconds,
      });
      return;
    }

    req.log.error({ err }, "BGG wishlist match fetch failed");
    res
      .status(502)
      .json({ error: err.message ?? "Failed to fetch wishlist matches" });
  }
});

router.get("/bgg/for-trade", async (req, res) => {
  const { username } = req.query as Record<string, string>;

  if (!username) {
    res.status(400).json({ error: "username is required" });
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
    const collectionXml = await fetchForTradeCollection(username, apiToken);
    const items = parseForTradeCollectionItems(collectionXml);

    res.json({
      username,
      totalForTrade: items.length,
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

    req.log.error({ err }, "BGG for-trade collection fetch failed");
    res
      .status(502)
      .json({ error: err.message ?? "Failed to fetch for-trade collection" });
  }
});

router.get("/bgg/marketplace-prices", async (req, res) => {
  const { objectId } = req.query as Record<string, string>;

  if (!objectId) {
    res.status(400).json({ error: "objectId is required" });
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
    const xml = await fetchBggXmlText(
      `${BGG_THING_API_BASE}?id=${encodeURIComponent(objectId)}&marketplace=1`,
      apiToken,
      "BGG marketplace",
      "BGG thing API",
      BGG_FETCH_TIMEOUT_MS,
    );

    const parser = createBggXmlParser(["item", "listing"]);
    const parsed = parser.parse(xml);

    // xmlapi2/thing wraps items in <items><item>
    const rawItem = asArray(parsed.items?.item ?? []).concat(asArray(parsed.item ?? []))[0];

    if (!rawItem) {
      req.log.warn({ snippet: xml.slice(0, 300) }, "No item in BGG thing API response");
      res.json({ objectId, listedCount: 0, lowestListedPrice: null, suggestedSb: null, suggestedBin: null });
      return;
    }

    const listings = asArray(rawItem.marketplacelistings?.listing ?? []);
    req.log.info({ objectId, listingCount: listings.length }, "BGG marketplace listings parsed");

    const prices = listings
      .map((l: any) => parseFloat(l.price?.["@_value"]))
      .filter((p: number) => Number.isFinite(p) && p > 0);

    if (prices.length === 0) {
      res.json({ objectId, listedCount: listings.length, lowestListedPrice: null, suggestedSb: null, suggestedBin: null });
      return;
    }

    const lowestListedPrice = Math.min(...prices);
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    // Round SB to nearest $0.50
    const suggestedSb = Math.round(lowestListedPrice * 0.75 * 2) / 2;
    // Round BIN up to nearest $1, or nearest $10 if over $100
    const binInterval = avgPrice > 100 ? 10 : 1;
    const suggestedBin = Math.ceil(avgPrice / binInterval) * binInterval;

    res.json({
      objectId,
      listedCount: prices.length,
      lowestListedPrice,
      suggestedSb,
      suggestedBin,
    });
  } catch (err: any) {
    if (err instanceof BggProcessingError) {
      res.status(202).set("Retry-After", String(err.retryAfterSeconds)).json({
        error: err.message,
        retryAfterSeconds: err.retryAfterSeconds,
      });
      return;
    }
    req.log.error({ err }, "BGG marketplace price fetch failed");
    res.status(502).json({ error: err.message ?? "Failed to fetch marketplace prices" });
  }
});

// ── GET /bgg/thing-batch ─────────────────────────────────────────────────────
// Returns enrichment data (categories, mechanics, player counts) for a list of
// BGG game IDs. Results are served from the in-process thingCache when warm,
// otherwise fetched from BGG with limited concurrency and cached for reuse.
router.get("/bgg/thing-batch", async (req, res) => {
  const raw = req.query.ids as string | undefined;
  if (!raw) {
    res.status(400).json({ error: "ids is required (comma-separated BGG object IDs)" });
    return;
  }
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > 200) {
    res.status(400).json({ error: "ids must be 1–200 comma-separated IDs" });
    return;
  }
  const apiToken = process.env[BGG_API_TOKEN_ENV_VAR]?.trim();
  if (!apiToken) {
    res.status(500).json({ error: `Missing ${BGG_API_TOKEN_ENV_VAR} configuration` });
    return;
  }

  try {
    const parser = createBggXmlParser(["item", "link"]);
    const now = Date.now();

    const uncachedIds = ids.filter((id) => {
      const entry = thingCache.get(id);
      return !entry || now - entry.cachedAt >= THING_CACHE_TTL_MS;
    });

    if (uncachedIds.length > 0) {
      const BATCH_SIZE = 50;
      const batches: string[][] = [];
      for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
        batches.push(uncachedIds.slice(i, i + BATCH_SIZE));
      }
      const tasks = batches.map((batch) => async () => {
        const xml = await fetchBggXmlText(
          `${BGG_THING_API_BASE}?id=${batch.join(",")}&type=boardgame,boardgameexpansion`,
          apiToken, "BGG thing", "BGG thing API", BGG_THING_BATCH_TIMEOUT_MS,
        );
        const parsed = parser.parse(xml);
        for (const thing of asArray(parsed.items?.item ?? [])) {
          const id = String(thing["@_id"] ?? "");
          if (!id) continue;
          const links = asArray(thing.link ?? []);
          const minP = parseInt(thing.minplayers?.["@_value"] ?? "0");
          const maxP = parseInt(thing.maxplayers?.["@_value"] ?? "0");
          const primaryName = asArray(thing.name).find((n: any) => n?.["@_type"] === "primary");
          thingCache.set(id, {
            categories: links.filter((l: any) => l["@_type"] === "boardgamecategory").map((l: any) => String(l["@_value"] ?? "")).filter(Boolean),
            mechanics: links.filter((l: any) => l["@_type"] === "boardgamemechanic").map((l: any) => String(l["@_value"] ?? "")).filter(Boolean),
            minPlayers: minP > 0 ? minP : undefined,
            maxPlayers: maxP > 0 ? maxP : undefined,
            primaryName: asText(primaryName?.["@_value"] ?? primaryName) || undefined,
            expansionBaseIds: links.filter((l: any) => l["@_type"] === "boardgameexpansion" && l["@_inbound"] === "true").map((l: any) => String(l["@_id"] ?? "")).filter(Boolean),
            cachedAt: Date.now(),
          });
        }
      });
      const results = await runWithConcurrencyLimit(tasks, THING_BATCH_CONCURRENCY);
      for (const r of results) {
        if (r.status === "rejected") req.log.warn({ err: r.reason }, "thing-batch batch failed");
      }
    }

    const out: Record<string, { categories: string[]; mechanics: string[]; minPlayers?: number; maxPlayers?: number }> = {};
    for (const id of ids) {
      const entry = thingCache.get(id);
      if (entry) out[id] = { categories: entry.categories, mechanics: entry.mechanics, minPlayers: entry.minPlayers, maxPlayers: entry.maxPlayers };
    }
    res.json(out);
  } catch (err: any) {
    req.log.error({ err }, "BGG thing-batch fetch failed");
    res.status(502).json({ error: err.message ?? "Failed to fetch thing data" });
  }
});

// ── GET /bgg/my-collection ────────────────────────────────────────────────────
router.get("/bgg/my-collection", async (req, res) => {
  const { username } = req.query as Record<string, string>;
  if (!username) {
    res.status(400).json({ error: "username is required" });
    return;
  }
  const apiToken = process.env[BGG_API_TOKEN_ENV_VAR]?.trim();
  if (!apiToken) {
    res.status(500).json({ error: `Missing ${BGG_API_TOKEN_ENV_VAR} configuration` });
    return;
  }

  try {
    const parser = createBggXmlParser(["item", "link"]);

    // ── Base games (owned, no expansions) ────────────────────────────────────
    const collectionXml = await fetchBggXmlText(
      `${BGG_COLLECTION_API_BASE}?username=${encodeURIComponent(username)}&stats=1&own=1&subtype=boardgame&excludesubtype=boardgameexpansion`,
      apiToken,
      "BGG collection",
      "BGG collection API",
      BGG_FETCH_TIMEOUT_MS,
    );

    const parsed = parser.parse(collectionXml);
    const rawItems = asArray(parsed.items?.item ?? []);

    if (rawItems.length === 0) {
      res.json({ username, games: [] });
      return;
    }

    const collectionMap = new Map<string, any>();
    for (const item of rawItems) {
      const objectId = String(item["@_objectid"] ?? "");
      if (!objectId) continue;
      const stats = item.stats ?? {};
      const weightRaw = parseFloat(stats.rating?.averageweight?.["@_value"] ?? "0");
      const minPlayers = parseInt(stats["@_minplayers"] ?? "0") || undefined;
      const maxPlayers = parseInt(stats["@_maxplayers"] ?? "0") || undefined;
      const numplays = parseInt(String(item.numplays ?? "0")) || 0;
      const status = item.status ?? {};
      const wantToPlay = String(status["@_wanttoplay"] ?? "0") === "1";
      const userRatingRaw = parseFloat(stats.rating?.["@_value"] ?? "");
      const communityRatingRaw = parseFloat(stats.rating?.average?.["@_value"] ?? "");
      collectionMap.set(objectId, {
        objectId,
        title: asText(item.name),
        thumbnail: asText(item.thumbnail) || undefined,
        minPlayers,
        maxPlayers,
        // Preserved separately so the UI can warn when an expansion is required
        baseMinPlayers: minPlayers,
        baseMaxPlayers: maxPlayers,
        playTime: parseInt(stats["@_playingtime"] ?? "0") || undefined,
        weight: Number.isFinite(weightRaw) && weightRaw > 0 ? weightRaw : undefined,
        numplays,
        wantToPlay,
        userRating: Number.isFinite(userRatingRaw) ? userRatingRaw : undefined,
        communityRating: Number.isFinite(communityRatingRaw) ? communityRatingRaw : undefined,
        categories: [] as string[],
        mechanics: [] as string[],
        expansionPlayerRanges: [] as { name: string; min: number; max: number }[],
      });
    }

    // ── Owned expansions (for player-count merging) ───────────────────────────
    let expansionObjectIds: string[] = [];
    try {
      const expansionXml = await fetchBggXmlText(
        `${BGG_COLLECTION_API_BASE}?username=${encodeURIComponent(username)}&own=1&subtype=boardgameexpansion`,
        apiToken,
        "BGG expansion collection",
        "BGG collection API",
        BGG_FETCH_TIMEOUT_MS,
      );
      const expParsed = parser.parse(expansionXml);
      expansionObjectIds = asArray(expParsed.items?.item ?? [])
        .map((item: any) => String(item["@_objectid"] ?? ""))
        .filter(Boolean);
    } catch {
      // Non-fatal — proceed without expansion player-count data
    }

    // ── Batch-fetch thing data for base games + expansions (with cache) ─────────
    const expansionIdSet = new Set(expansionObjectIds);
    const expansionData = new Map<string, { name: string; min: number; max: number; baseIds: string[] }>();

    const now = Date.now();
    const allIds = [...collectionMap.keys(), ...expansionObjectIds];

    // Separate IDs into cached vs. need-to-fetch
    const cachedIds = allIds.filter((id) => {
      const entry = thingCache.get(id);
      return entry && now - entry.cachedAt < THING_CACHE_TTL_MS;
    });
    const uncachedIds = allIds.filter((id) => !cachedIds.includes(id));

    req.log.info({ total: allIds.length, cached: cachedIds.length, uncached: uncachedIds.length }, "Thing data cache status");

    // Fetch uncached IDs in batches with limited concurrency
    if (uncachedIds.length > 0) {
      const BATCH_SIZE = 50;
      const batches: string[][] = [];
      for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
        batches.push(uncachedIds.slice(i, i + BATCH_SIZE));
      }

      const batchTasks = batches.map((batch, batchIdx) => async () => {
        const xml = await fetchBggXmlText(
          `${BGG_THING_API_BASE}?id=${batch.join(",")}&type=boardgame,boardgameexpansion`,
          apiToken,
          "BGG thing",
          "BGG thing API",
          BGG_THING_BATCH_TIMEOUT_MS,
        );
        const thingParsed = parser.parse(xml);
        const thingItems = asArray(thingParsed.items?.item ?? []);
        for (const thing of thingItems) {
          const id = String(thing["@_id"] ?? "");
          const links = asArray(thing.link ?? []);
          const minP = parseInt(thing.minplayers?.["@_value"] ?? "0");
          const maxP = parseInt(thing.maxplayers?.["@_value"] ?? "0");
          const primaryName = asArray(thing.name).find((n: any) => n?.["@_type"] === "primary");
          const primaryNameStr = asText(primaryName?.["@_value"] ?? primaryName) || undefined;
          const categories = links
            .filter((l: any) => l["@_type"] === "boardgamecategory")
            .map((l: any) => String(l["@_value"] ?? ""))
            .filter(Boolean);
          const mechanics = links
            .filter((l: any) => l["@_type"] === "boardgamemechanic")
            .map((l: any) => String(l["@_value"] ?? ""))
            .filter(Boolean);
          const expansionBaseIds = links
            .filter((l: any) => l["@_type"] === "boardgameexpansion" && l["@_inbound"] === "true")
            .map((l: any) => String(l["@_id"] ?? ""))
            .filter(Boolean);
          thingCache.set(id, {
            categories,
            mechanics,
            minPlayers: minP > 0 ? minP : undefined,
            maxPlayers: maxP > 0 ? maxP : undefined,
            primaryName: primaryNameStr,
            expansionBaseIds,
            cachedAt: Date.now(),
          });
        }
        return batchIdx;
      });

      const batchResults = await runWithConcurrencyLimit(batchTasks, THING_BATCH_CONCURRENCY);
      for (const result of batchResults) {
        if (result.status === "rejected") {
          req.log.warn({ err: result.reason }, "Thing API batch failed — skipping enrichment for batch");
        }
      }
    }

    // Apply cached data to collection map and expansion data
    for (const id of allIds) {
      const cached = thingCache.get(id);
      if (!cached) continue;

      if (expansionIdSet.has(id)) {
        const { primaryName, minPlayers, maxPlayers, expansionBaseIds } = cached;
        if (minPlayers && maxPlayers && expansionBaseIds) {
          expansionData.set(id, {
            name: primaryName ?? `Expansion ${id}`,
            min: minPlayers,
            max: maxPlayers,
            baseIds: expansionBaseIds,
          });
        }
      } else if (collectionMap.has(id)) {
        const game = collectionMap.get(id)!;
        game.categories = cached.categories;
        game.mechanics = cached.mechanics;
      }
    }

    // ── Merge expansion player counts into base games ─────────────────────────
    for (const { name, min, max, baseIds } of expansionData.values()) {
      for (const baseId of baseIds) {
        const game = collectionMap.get(baseId);
        if (!game) continue;
        const widens =
          (game.baseMinPlayers != null && min < game.baseMinPlayers) ||
          (game.baseMaxPlayers != null && max > game.baseMaxPlayers);
        if (widens) {
          game.expansionPlayerRanges.push({ name, min, max });
        }
        if (!game.minPlayers || min < game.minPlayers) game.minPlayers = min;
        if (!game.maxPlayers || max > game.maxPlayers) game.maxPlayers = max;
      }
    }

    res.json({ username, games: [...collectionMap.values()] });
  } catch (err: any) {
    if (err instanceof BggProcessingError) {
      res.status(202).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "BGG my-collection fetch failed");
    res.status(502).json({ error: err.message ?? "Failed to fetch collection" });
  }
});

export default router;

