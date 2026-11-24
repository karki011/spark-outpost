import Foundation

public struct HeardLine: Equatable, Sendable {
    public var text: String
    public var startMs: Int
    public var endMs: Int

    public init(text: String, startMs: Int, endMs: Int) {
        self.text = text
        self.startMs = startMs
        self.endMs = endMs
    }
}

public struct EchoRules: Sendable {
    public var slackMs = 2_000
    public var sharedWords = 0.7
    public var remembered = 40

    public init() {}
}

func echoWords(_ text: String) -> [String] {
    text.lowercased()
        .components(separatedBy: CharacterSet.alphanumerics.inverted)
        .filter { !$0.isEmpty }
}

func echoSentences(_ text: String) -> [String] {
    var sentences: [String] = []
    var current = ""
    var closing = false
    for character in text {
        if closing && character.isWhitespace {
            sentences.append(current)
            current = ""
            closing = false
            continue
        }
        current.append(character)
        closing = ".!?".contains(character)
    }
    sentences.append(current)
    return sentences.filter { !echoWords($0).isEmpty }
}

func sharedInOrder(_ words: [String], _ played: [String]) -> Int {
    guard !words.isEmpty, !played.isEmpty else { return 0 }
    var previous = [Int](repeating: 0, count: played.count + 1)
    for word in words {
        var row = [Int](repeating: 0, count: played.count + 1)
        for (index, other) in played.enumerated() {
            row[index + 1] = word == other ? previous[index] + 1 : max(previous[index + 1], row[index])
        }
        previous = row
    }
    return previous[played.count]
}

public func withoutEcho(
    _ line: HeardLine, of others: [HeardLine], rules: EchoRules = EchoRules()
) -> String? {
    let played = others
        .filter { $0.startMs <= line.endMs + rules.slackMs && $0.endMs >= line.startMs - rules.slackMs }
        .sorted { $0.startMs < $1.startMs }
        .flatMap { echoWords($0.text) }
    let kept = echoSentences(line.text).filter { sentence in
        let words = echoWords(sentence)
        return Double(sharedInOrder(words, played)) < Double(words.count) * rules.sharedWords
    }
    return kept.isEmpty ? nil : kept.joined(separator: " ")
}

public func isEcho(_ line: HeardLine, of others: [HeardLine], rules: EchoRules = EchoRules()) -> Bool {
    withoutEcho(line, of: others, rules: rules) == nil
}
