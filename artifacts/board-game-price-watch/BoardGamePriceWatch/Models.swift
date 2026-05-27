import Foundation

enum GameCondition: String, Codable, CaseIterable, Identifiable {
    case any = "Any"
    case new = "New"
    case likeNew = "Like New"
    case veryGood = "Very Good"
    case good = "Good"
    case acceptable = "Acceptable"

    var id: String { rawValue }
}

struct BoardGameOffer: Identifiable, Codable, Equatable {
    var id: String
    var gameTitle: String
    var price: Double
    var condition: GameCondition
    var sourceName: String
    var sellerName: String
    var listingURL: URL?
    var observedAt: Date
}

struct BoardGameWatchItem: Identifiable, Codable, Equatable {
    var id: UUID
    var title: String
    var maximumPrice: Double
    var preferredCondition: GameCondition
    var sourceHint: String
    var notes: String
    var isEnabled: Bool
    var lastMatchedOffer: BoardGameOffer?
    var lastNotifiedOfferID: String?
    var createdAt: Date
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        title: String,
        maximumPrice: Double,
        preferredCondition: GameCondition = .any,
        sourceHint: String = "",
        notes: String = "",
        isEnabled: Bool = true,
        lastMatchedOffer: BoardGameOffer? = nil,
        lastNotifiedOfferID: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.maximumPrice = maximumPrice
        self.preferredCondition = preferredCondition
        self.sourceHint = sourceHint
        self.notes = notes
        self.isEnabled = isEnabled
        self.lastMatchedOffer = lastMatchedOffer
        self.lastNotifiedOfferID = lastNotifiedOfferID
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

