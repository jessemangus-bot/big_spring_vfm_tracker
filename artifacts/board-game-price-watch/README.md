# BoardGamePriceWatch

Native SwiftUI app for iPhone, iPad, and Mac.

The app tracks board games a user wants and notifies them when an available copy is found at or below their acceptable price.

## MVP Included

- Universal Apple app structure for iOS, iPadOS, and macOS
- BoardGameGeek search when adding a game
- BGG game ID/year stored on each watch item so the exact game is targeted
- Local watchlist persistence
- Target price per game
- Preferred condition per game
- Demo availability scanner
- Local notification manager
- Adaptive `NavigationSplitView` UI for phone, tablet, and desktop

## Next Source Integrations

The app currently uses a deterministic demo scanner so the UI and notification flow can be tested without depending on marketplace APIs. Real source adapters can be added behind `PriceScanService`, for example:

- BoardGameGeek market listings
- eBay saved searches
- Retailer stock/price feeds
- Local store inventory feeds

## Open In Xcode

Open:

```text
BoardGamePriceWatch.xcodeproj
```

Schemes:

- `BoardGamePriceWatch iOS`
- `BoardGamePriceWatch macOS`
