import Foundation
import SwiftUI

@MainActor
final class WatchlistStore: ObservableObject {
    @Published private(set) var items: [BoardGameWatchItem] = []
    @Published private(set) var isScanning = false
    @Published private(set) var lastScanAt: Date?

    private let scanner = PriceScanService()
    private let fileName = "watchlist.json"

    init() {
        load()
    }

    func binding(for id: UUID) -> Binding<BoardGameWatchItem>? {
        guard items.contains(where: { $0.id == id }) else { return nil }

        return Binding(
            get: { [weak self] in
                self?.items.first(where: { $0.id == id }) ?? BoardGameWatchItem(title: "", maximumPrice: 0)
            },
            set: { [weak self] newValue in
                self?.update(newValue)
            }
        )
    }

    func addBlankItem() -> UUID {
        let item = BoardGameWatchItem(title: "New game", maximumPrice: 40)
        items.insert(item, at: 0)
        save()
        return item.id
    }

    func update(_ item: BoardGameWatchItem) {
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return }

        var updated = item
        updated.updatedAt = Date()
        items[index] = updated
        save()
    }

    func delete(_ id: UUID) {
        items.removeAll { $0.id == id }
        save()
    }

    func scan(notificationManager: NotificationManager) async {
        guard !isScanning else { return }

        isScanning = true
        defer { isScanning = false }

        do {
            let matches = try await scanner.scan(items: items)

            for (itemID, offer) in matches {
                guard let index = items.firstIndex(where: { $0.id == itemID }) else { continue }

                items[index].lastMatchedOffer = offer
                items[index].updatedAt = Date()

                if items[index].lastNotifiedOfferID != offer.id {
                    let notificationItem = items[index]
                    await notificationManager.notify(match: offer, for: notificationItem)
                    items[index].lastNotifiedOfferID = offer.id
                }
            }

            lastScanAt = Date()
            save()
        } catch {
            lastScanAt = Date()
        }
    }

    private func load() {
        let url = storageURL

        guard
            FileManager.default.fileExists(atPath: url.path),
            let data = try? Data(contentsOf: url),
            let decoded = try? JSONDecoder.appDecoder.decode([BoardGameWatchItem].self, from: data)
        else {
            items = Self.sampleItems
            save()
            return
        }

        items = decoded
    }

    private func save() {
        let url = storageURL

        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder.appEncoder.encode(items)
            try data.write(to: url, options: [.atomic])
        } catch {
            // Local persistence should never block the UI.
        }
    }

    private var storageURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("BoardGamePriceWatch", isDirectory: true).appendingPathComponent(fileName)
    }

    private static let sampleItems: [BoardGameWatchItem] = [
        BoardGameWatchItem(title: "Ark Nova", maximumPrice: 50, preferredCondition: .good, sourceHint: "BGG Market"),
        BoardGameWatchItem(title: "Dune: Imperium", maximumPrice: 40, preferredCondition: .likeNew, sourceHint: "Retail or local"),
        BoardGameWatchItem(title: "Brass: Birmingham", maximumPrice: 55, preferredCondition: .good, sourceHint: "Any trusted source"),
    ]
}

private extension JSONEncoder {
    static var appEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension JSONDecoder {
    static var appDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
