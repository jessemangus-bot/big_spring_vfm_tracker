import Foundation
import UserNotifications

@MainActor
final class NotificationManager: ObservableObject {
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined

    init() {
        Task {
            await refreshAuthorizationStatus()
        }
    }

    func requestPermission() async {
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            await refreshAuthorizationStatus()
        } catch {
            await refreshAuthorizationStatus()
        }
    }

    func refreshAuthorizationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
    }

    func notify(match offer: BoardGameOffer, for item: BoardGameWatchItem) async {
        guard authorizationStatus == .authorized || authorizationStatus == .provisional else { return }

        let content = UNMutableNotificationContent()
        content.title = "\(item.title) is available"
        content.body = "\(offer.sourceName) has \(offer.condition.rawValue.lowercased()) copy for \(offer.price.formatted(.currency(code: "USD")))."
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "price-match-\(item.id.uuidString)-\(offer.id)",
            content: content,
            trigger: nil
        )

        try? await UNUserNotificationCenter.current().add(request)
    }
}

