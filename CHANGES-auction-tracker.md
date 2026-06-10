# Auction Tracker integration — changes

Adds an auctioneer's-view bid tracker to big_spring_vfm_tracker: pick a
tracked geeklist auction and see every item's current high bid and who's
winning, with your own bids highlighted. Complements the existing
/bgg/geeklist endpoints, which report only the configured user's activity.

## New files

- `artifacts/api-server/src/routes/auction.ts`
  GET /api/bgg/auction/bids?listId=<id>&username=<optional>
  Parses ALL bid comments per item (not just one user's): high bid, high
  bidder, BIN claims, SB/BIN prices from the body, and your winning/outbid
  status when a username is supplied. Honors BGG strikethrough conventions
  (struck-out prices don't count), skips seller comments and retractions,
  and attaches confidence flags to ambiguous bids instead of trusting them.
  Self-contained — shares nothing with bgg.ts, uses the same BGG_API_TOKEN
  env var (already configured), same 202/Retry-After pattern, 60s XML cache.

- `artifacts/bgg-vfm/app/auction-tracker.tsx`
  New Expo screen. Tracked-auction chips (long-press to remove), add-by-URL,
  optional BGG username for winning/outbid pills, filters (all / has bids /
  no bids / my bids), expandable per-item bid history, "View / bid on BGG"
  link. Tracked list + username persist in AsyncStorage. Follows
  browse-vfm.tsx conventions (getBaseUrl + fetch, useColors, Inter fonts).

## Modified files

- `artifacts/api-server/src/routes/index.ts` — mounts auctionRouter.
- `artifacts/bgg-vfm/app/_layout.tsx` — registers the auction-tracker screen.
- `artifacts/bgg-vfm/app/(tabs)/index.tsx` — adds a dashboard icon button
  (trending-up) next to Browse VFM that opens the tracker.
- `lib/api-spec/openapi.yaml` — documents /bgg/auction/bids and its schemas
  (BggAuctionBidsResponse, BggAuctionItem, BggAuctionHighBid, BggAuctionBid).
  Regenerate clients with your usual orval flow if you want typed hooks; the
  screen intentionally uses plain fetch (like browse-vfm) so codegen is not
  required for it to work.

## Deploy

1. Copy these files into the repo at the same paths (or apply via PR).
2. `pnpm install` (no new dependencies were added) and `pnpm run typecheck`.
3. Push to main — DO redeploys. No new env vars: it reuses BGG_API_TOKEN.

## Notes

- Bid parsing is heuristic by nature (bids are free text). Items whose high
  bid was inferred with low confidence show a flag and the raw comment so
  you can verify on BGG rather than trust a wrong number.
- Optional refinement: seed the username field from VFMContext's BggSettings
  instead of its own AsyncStorage key. Kept separate to avoid touching the
  context's interface in this change.
