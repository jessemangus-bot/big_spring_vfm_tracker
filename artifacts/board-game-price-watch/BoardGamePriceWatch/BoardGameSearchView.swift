import SwiftUI

struct BoardGameSearchView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [BoardGameReference] = []
    @State private var isSearching = false
    @State private var errorMessage: String?

    let onSelect: (BoardGameReference) -> Void

    private let service = BoardGameGeekService()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Choose the exact BoardGameGeek game to watch.")
                        .foregroundStyle(.secondary)

                    HStack {
                        TextField("Game title", text: $query)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit {
                                Task { await search() }
                            }

                        Button {
                            Task { await search() }
                        } label: {
                            Label("Search", systemImage: "magnifyingglass")
                        }
                        .disabled(isSearching || query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .padding()

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                        .padding(.horizontal)
                        .padding(.bottom, 8)
                }

                List {
                    if isSearching {
                        HStack {
                            ProgressView()
                            Text("Searching BoardGameGeek")
                                .foregroundStyle(.secondary)
                        }
                    } else if results.isEmpty {
                        VStack(alignment: .center, spacing: 12) {
                            Image(systemName: "dice")
                                .font(.system(size: 32))
                                .foregroundStyle(.secondary)

                            Text("No BGG Game Selected")
                                .font(.headline)

                            Text("Search for a game, then select the matching BoardGameGeek entry.")
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 28)
                    } else {
                        ForEach(results) { reference in
                            Button {
                                onSelect(reference)
                                dismiss()
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(reference.name)
                                            .font(.headline)

                                        HStack(spacing: 8) {
                                            Text("BGG #\(reference.bggID)")

                                            if let yearPublished = reference.yearPublished {
                                                Text(String(yearPublished))
                                            }
                                        }
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    }

                                    Spacer()

                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .navigationTitle("Add BGG Game")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
        .frame(minWidth: 420, minHeight: 480)
    }

    private func search() async {
        guard !isSearching else { return }

        isSearching = true
        errorMessage = nil
        defer { isSearching = false }

        do {
            results = try await service.searchGames(matching: query)
            if results.isEmpty {
                errorMessage = "No matching BoardGameGeek games found."
            }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
