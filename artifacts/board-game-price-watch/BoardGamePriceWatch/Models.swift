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

struct BoardGameReference: Identifiable, Codable, Equatable {
    var bggID: Int
    var name: String
    var yearPublished: Int?

    var id: Int { bggID }

    var displayTitle: String {
        guard let yearPublished else { return name }
        return "\(name) (\(yearPublished))"
    }

    var boardGameGeekURL: URL {
        URL(string: "https://boardgamegeek.com/boardgame/\(bggID)")!
    }
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
    var bggID: Int?
    var bggName: String?
    var yearPublished: Int?
    var maximumPrice: Double
    var preferredCondition: GameCondition
    var sourceHint: String
    var notes: String
    var isEnabled: Bool
    var lastMatchedOffer: BoardGameOffer?
    var lastNotifiedOfferID: String?
    var createdAt: Date
    var updatedAt: Date

    var displayTitle: String {
        bggReference?.displayTitle ?? title
    }

    var bggReference: BoardGameReference? {
        guard let bggID else { return nil }

        return BoardGameReference(
            bggID: bggID,
            name: bggName ?? title,
            yearPublished: yearPublished
        )
    }

    init(
        id: UUID = UUID(),
        title: String,
        bggID: Int? = nil,
        bggName: String? = nil,
        yearPublished: Int? = nil,
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
        self.bggID = bggID
        self.bggName = bggName
        self.yearPublished = yearPublished
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

    init(
        id: UUID = UUID(),
        reference: BoardGameReference,
        maximumPrice: Double,
        preferredCondition: GameCondition = .any,
        sourceHint: String = "BoardGameGeek",
        notes: String = "",
        isEnabled: Bool = true,
        lastMatchedOffer: BoardGameOffer? = nil,
        lastNotifiedOfferID: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.init(
            id: id,
            title: reference.name,
            bggID: reference.bggID,
            bggName: reference.name,
            yearPublished: reference.yearPublished,
            maximumPrice: maximumPrice,
            preferredCondition: preferredCondition,
            sourceHint: sourceHint,
            notes: notes,
            isEnabled: isEnabled,
            lastMatchedOffer: lastMatchedOffer,
            lastNotifiedOfferID: lastNotifiedOfferID,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}
