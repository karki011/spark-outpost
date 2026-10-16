import Foundation

private let linkDetector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

public func noteLinks(in notes: String) -> [String] {
    guard let linkDetector, !notes.isEmpty else { return [] }
    let range = NSRange(notes.startIndex..., in: notes)
    var links: [String] = []
    for match in linkDetector.matches(in: notes, range: range) {
        guard let link = httpsLink(match.url), !links.contains(link) else { continue }
        links.append(link)
        if links.count == Limits.noteLinks { break }
    }
    return links
}

private func httpsLink(_ url: URL?) -> String? {
    guard let url, url.scheme?.lowercased() == "https", url.host != nil else { return nil }
    let link = url.absoluteString
    return link.utf16.count <= Limits.longText ? link : nil
}
