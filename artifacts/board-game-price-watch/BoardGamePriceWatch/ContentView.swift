import SwiftUI
import UserNotifications

struct ContentView: View {
    @StateObject private var store = WatchlistStore()
    @StateObject private var notificationManager = NotificationManager()
    @State private var selection: BoardGameWatchItem.ID?

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section("Watchlist") {
                    ForEach(store.items) { item in
                        WatchlistRow(item: item)
                            .tag(item.id)
                    }
                    .onDelete { offsets in
                        for offset in offsets {
                            store.delete(store.items[offset].id)
                        }
                        if let selection, !store.items.contains(where: { $0.id == selection }) {
                            self.selection = store.items.first?.id
                        }
                    }
                }
            }
            .navigationTitle("Price Watch")
            .toolbar {
                ToolbarItemGroup {
                    Button {
                        selection = store.addBlankItem()
                    } label: {
                        Label("Add Game", systemImage: "plus")
                    }

                    Button {
                        Task {
                            if notificationManager.authorizationStatus == .notDetermined {
                                await notificationManager.requestPermission()
                            }
                            await store.scan(notificationManager: notificationManager)
                        }
                    } label: {
                        Label("Scan", systemImage: "arrow.clockwise")
                    }
                    .disabled(store.isScanning)
                }
            }
        } detail: {
            if let selection, let binding = store.binding(for: selection) {
                WatchItemDetail(
                    item: binding,
                    isScanning: store.isScanning,
                    lastScanAt: store.lastScanAt,
                    notificationStatus: notificationManager.authorizationStatus,
                    requestNotifications: {
                        await notificationManager.requestPermission()
                    },
                    scan: {
                        await store.scan(notificationManager: notificationManager)
                    },
                    delete: {
                        store.delete(selection)
                        self.selection = store.items.first?.id
                    }
                )
            } else {
                EmptyStateView {
                    selection = store.addBlankItem()
                }
            }
        }
        .onAppear {
            if selection == nil {
                selection = store.items.first?.id
            }
        }
    }
}

private struct WatchlistRow: View {
    let item: BoardGameWatchItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(item.title)
                    .font(.headline)
                    .lineLimit(1)

                Spacer()

                if item.lastMatchedOffer != nil {
                    Image(systemName: "bell.badge.fill")
                        .foregroundStyle(.green)
                }
            }

            HStack(spacing: 8) {
                Text("Target \(item.maximumPrice.formatted(.currency(code: "USD")))")

                if let offer = item.lastMatchedOffer {
                    Text("Found \(offer.price.formatted(.currency(code: "USD")))")
                        .foregroundStyle(.green)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct WatchItemDetail: View {
    @Binding var item: BoardGameWatchItem
    let isScanning: Bool
    let lastScanAt: Date?
    let notificationStatus: UNAuthorizationStatus
    let requestNotifications: () async -> Void
    let scan: () async -> Void
    let delete: () -> Void

    var body: some View {
        Form {
            Section("Game") {
                TextField("Board game title", text: $item.title)
                TextField("Maximum price", value: $item.maximumPrice, format: .currency(code: "USD"))

                Picker("Minimum condition", selection: $item.preferredCondition) {
                    ForEach(GameCondition.allCases) { condition in
                        Text(condition.rawValue).tag(condition)
                    }
                }

                Toggle("Watch this game", isOn: $item.isEnabled)
            }

            Section("Sources") {
                TextField("Preferred source", text: $item.sourceHint, prompt: Text("BGG Market, eBay, local store"))
                TextField("Notes", text: $item.notes, axis: .vertical)
                    .lineLimit(3...6)
            }

            Section("Latest Match") {
                if let offer = item.lastMatchedOffer {
                    OfferSummaryView(offer: offer)
                } else {
                    Label("No matching offer found yet", systemImage: "magnifyingglass")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Scanning") {
                HStack {
                    Button {
                        Task {
                            await scan()
                        }
                    } label: {
                        Label(isScanning ? "Scanning" : "Scan Now", systemImage: "arrow.clockwise")
                    }
                    .disabled(isScanning)

                    Spacer()

                    if let lastScanAt {
                        Text(lastScanAt, style: .time)
                            .foregroundStyle(.secondary)
                    }
                }

                Button {
                    Task {
                        await requestNotifications()
                    }
                } label: {
                    Label(notificationButtonTitle, systemImage: notificationIconName)
                }
                .disabled(notificationStatus == .authorized || notificationStatus == .provisional)
            }

            Section {
                Button(role: .destructive, action: delete) {
                    Label("Delete Watch", systemImage: "trash")
                }
            }
        }
        .navigationTitle(item.title.isEmpty ? "Game Watch" : item.title)
    }

    private var notificationButtonTitle: String {
        switch notificationStatus {
        case .authorized, .provisional:
            return "Notifications Enabled"
        case .denied:
            return "Notifications Disabled In Settings"
        case .notDetermined:
            return "Enable Notifications"
        case .ephemeral:
            return "Temporary Notifications Enabled"
        @unknown default:
            return "Check Notification Permission"
        }
    }

    private var notificationIconName: String {
        switch notificationStatus {
        case .authorized, .provisional, .ephemeral:
            return "bell.fill"
        case .denied:
            return "bell.slash"
        case .notDetermined:
            return "bell"
        @unknown default:
            return "bell"
        }
    }
}

private struct OfferSummaryView: View {
    let offer: BoardGameOffer

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(offer.sourceName, systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)

                Spacer()

                Text(offer.price.formatted(.currency(code: "USD")))
                    .font(.title3.weight(.semibold))
            }

            Text("\(offer.condition.rawValue) from \(offer.sellerName)")
                .foregroundStyle(.secondary)

            Text("Observed \(offer.observedAt.formatted(date: .abbreviated, time: .shortened))")
                .font(.caption)
                .foregroundStyle(.secondary)

            if let url = offer.listingURL {
                Link(destination: url) {
                    Label("Open listing", systemImage: "arrow.up.right.square")
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct EmptyStateView: View {
    let add: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "dice.fill")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)

            Text("Add a game to watch")
                .font(.title2.weight(.semibold))

            Button(action: add) {
                Label("Add Game", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
