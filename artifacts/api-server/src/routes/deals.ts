import { Router, type IRouter } from "express";

const router: IRouter = Router();

const DEALS_CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export interface DealItem {
  id: string;
  retailer: string;
  title: string;
  salePrice: number;
  originalPrice?: number;
  discountPercent?: number;
  imageUrl?: string;
  url: string;
}

interface DealsCache {
  items: DealItem[];
  fetchedAt: number;
}

let dealsCache: DealsCache | null = null;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchShopifyCollectionDeals(
  retailer: string,
  domain: string,
  collectionHandle: string,
  limit = 10,
): Promise<DealItem[]> {
  try {
    const url = `https://${domain}/collections/${collectionHandle}/products.json?limit=${limit}`;
    const resp = await fetchWithTimeout(url, {
      headers: { "User-Agent": "BGG-VFM-App/1.0" },
    });
    if (!resp.ok) return [];

    const data = (await resp.json()) as { products?: any[] };

    return (data.products ?? []).flatMap((product: any) => {
      const variant = product.variants?.[0];
      if (!variant) return [];

      const salePrice = parseFloat(variant.price ?? "0");
      if (!salePrice) return [];

      const originalPrice = variant.compare_at_price
        ? parseFloat(variant.compare_at_price)
        : undefined;
      const discountPercent =
        originalPrice && originalPrice > salePrice
          ? Math.round((1 - salePrice / originalPrice) * 100)
          : undefined;

      return [
        {
          id: `${domain}_${product.id}`,
          retailer,
          title: product.title,
          salePrice,
          originalPrice,
          discountPercent,
          imageUrl: product.images?.[0]?.src ?? undefined,
          url: `https://${domain}/products/${product.handle}`,
        } satisfies DealItem,
      ];
    });
  } catch {
    return [];
  }
}

async function fetchAllDeals(): Promise<DealItem[]> {
  const results = await Promise.allSettled([
    fetchShopifyCollectionDeals("Game Nerdz", "www.gamenerdz.com", "deal-of-the-day", 10),
    fetchShopifyCollectionDeals("Game Nerdz", "www.gamenerdz.com", "clearance", 10),
  ]);

  const allDeals: DealItem[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allDeals.push(...result.value);
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  return allDeals.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

router.get("/deals", async (req, res) => {
  const now = Date.now();

  if (dealsCache && now - dealsCache.fetchedAt < DEALS_CACHE_TTL_MS) {
    return res.json({
      items: dealsCache.items,
      fetchedAt: new Date(dealsCache.fetchedAt).toISOString(),
      cached: true,
    });
  }

  try {
    const items = await fetchAllDeals();
    dealsCache = { items, fetchedAt: now };
    return res.json({
      items,
      fetchedAt: new Date(now).toISOString(),
      cached: false,
    });
  } catch (err: any) {
    req.log.error({ err }, "Deals fetch failed");
    return res.status(500).json({ error: err.message ?? "Failed to fetch deals" });
  }
});

export default router;
