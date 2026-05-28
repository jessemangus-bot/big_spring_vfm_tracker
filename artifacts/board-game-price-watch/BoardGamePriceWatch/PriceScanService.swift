import Foundation

struct PriceScanService {
    func scan(items: [BoardGameWatchItem]) async throws -> [UUID: BoardGameOffer] {
        try await Task.sleep(for: .milliseconds(650))

        var matches: [UUID: BoardGameOffer] = [:]

        for item in items where item.isEnabled {
            guard let offer = demoOffer(for: item) else { continue }

            if offer.price <= item.maximumPrice && conditionMatches(offer.condition, item.preferredCondition) {
                matches[item.id] = offer
            }
        }

        return matches
    }

    private func demoOffer(for item: BoardGameWatchItem) -> BoardGameOffer? {
        let normalizedTitle = item.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalizedTitle.isEmpty else { return nil }

        let catalog: [Int: BoardGameOffer] = [
            342942: BoardGameOffer(
                id: "demo-ark-nova-45",
                gameTitle: "Ark Nova",
                price: 44.99,
                condition: .veryGood,
                sourceName: "BoardGameGeek Market",
                sellerName: "DemoSeller",
                listingURL: URL(string: "https://boardgamegeek.com/boardgame/342942/ark-nova"),
                observedAt: Date()
            ),
            316554: BoardGameOffer(
                id: "demo-dune-imperium-36",
                gameTitle: "Dune: Imperium",
                price: 36.00,
                condition: .likeNew,
                sourceName: "Local Game Store",
                sellerName: "Demo Inventory",
                listingURL: nil,
                observedAt: Date()
            ),
            224517: BoardGameOffer(
                id: "demo-brass-birmingham-58",
                gameTitle: "Brass: Birmingham",
                price: 58.00,
                condition: .good,
                sourceName: "eBay Saved Search",
                sellerName: "DemoAuctionHouse",
                listingURL: URL(string: "https://boardgamegeek.com/boardgame/224517/brass-birmingham"),
                observedAt: Date()
            ),
        ]

        if let bggID = item.bggID, let exact = catalog[bggID] {
            return exact
        }

        return catalog.first {
            let gameTitle = $0.value.gameTitle.lowercased()
            return normalizedTitle.contains(gameTitle) || gameTitle.contains(normalizedTitle)
        }?.value
    }

    private func conditionMatches(_ offerCondition: GameCondition, _ preferredCondition: GameCondition) -> Bool {
        guard preferredCondition != .any else { return true }

        let ranking: [GameCondition: Int] = [
            .new: 5,
            .likeNew: 4,
            .veryGood: 3,
            .good: 2,
            .acceptable: 1,
            .any: 0,
        ]

        return (ranking[offerCondition] ?? 0) >= (ranking[preferredCondition] ?? 0)
    }
}
