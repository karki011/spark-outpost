public enum Limits {
    public static let readNodes = 5_000
    public static let readDepth = 30
    public static let role = 100
    public static let title = 300
    public static let value = 400
    public static let action = 60
    public static let actionCount = 20
    public static let ancestors = 3
    public static let windows = 50
    public static let apps = 200
    public static let appName = 200
    public static let bundleId = 200
    public static let path = 4096
    public static let teamId = 20
    public static let message = 500
    public static let refNumberMax = 999_999_999
}

public func clip(_ text: String, _ maxUTF16: Int) -> String {
    if text.utf16.count <= maxUTF16 { return text }
    var result = ""
    var used = 0
    for character in text {
        let width = character.utf16.count
        if used + width > maxUTF16 { break }
        result.append(character)
        used += width
    }
    return result
}

public func clipNonEmpty(_ text: String?, _ maxUTF16: Int) -> String? {
    guard let text, !text.isEmpty else { return nil }
    return clip(text, maxUTF16)
}

func clippedActions(_ actions: [String]) -> [String] {
    actions.prefix(Limits.actionCount).map { clip($0, Limits.action) }
}
