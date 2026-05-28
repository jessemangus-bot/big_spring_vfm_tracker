import Foundation

enum BoardGameGeekServiceError: LocalizedError {
    case emptyQuery
    case invalidResponse
    case searchFailed

    var errorDescription: String? {
        switch self {
        case .emptyQuery:
            return "Enter a game title to search BoardGameGeek."
        case .invalidResponse:
            return "BoardGameGeek returned an unexpected response."
        case .searchFailed:
            return "Could not search BoardGameGeek right now."
        }
    }
}

struct BoardGameGeekService {
    func searchGames(matching query: String) async throws -> [BoardGameReference] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else { throw BoardGameGeekServiceError.emptyQuery }

        var components = URLComponents(string: "https://boardgamegeek.com/xmlapi2/search")
        components?.queryItems = [
            URLQueryItem(name: "query", value: trimmedQuery),
            URLQueryItem(name: "type", value: "boardgame"),
        ]

        guard let url = components?.url else { throw BoardGameGeekServiceError.invalidResponse }

        let (data, response) = try await URLSession.shared.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw BoardGameGeekServiceError.searchFailed
        }

        return try BGGSearchParser.parse(data: data)
    }
}

private final class BGGSearchParser: NSObject, XMLParserDelegate {
    private var results: [BoardGameReference] = []
    private var currentID: Int?
    private var currentName: String?
    private var currentYear: Int?

    static func parse(data: Data) throws -> [BoardGameReference] {
        let delegate = BGGSearchParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate

        guard parser.parse() else {
            throw parser.parserError ?? BoardGameGeekServiceError.invalidResponse
        }

        return delegate.results
    }

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        switch elementName {
        case "item":
            currentID = Int(attributeDict["id"] ?? "")
            currentName = nil
            currentYear = nil
        case "name":
            guard currentID != nil, attributeDict["type"] == "primary" else { return }
            currentName = attributeDict["value"]
        case "yearpublished":
            guard currentID != nil else { return }
            currentYear = Int(attributeDict["value"] ?? "")
        default:
            break
        }
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        guard elementName == "item" else { return }

        if let currentID, let currentName, !currentName.isEmpty {
            results.append(
                BoardGameReference(
                    bggID: currentID,
                    name: currentName,
                    yearPublished: currentYear
                )
            )
        }

        currentID = nil
        currentName = nil
        currentYear = nil
    }
}
