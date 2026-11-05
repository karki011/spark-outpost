import Foundation

private let wholeSeconds: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    formatter.timeZone = TimeZone.current
    return formatter
}()

private let fractionalSeconds: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

public func isoString(_ date: Date) -> String {
    wholeSeconds.string(from: date)
}

public func parseInstant(_ text: String) -> Date? {
    wholeSeconds.date(from: text) ?? fractionalSeconds.date(from: text)
}

func sameInstant(_ first: Date, _ second: Date) -> Bool {
    abs(first.timeIntervalSince(second)) < 1
}
