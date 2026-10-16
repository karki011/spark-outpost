import Foundation

public enum Purpose: String, Sendable {
    case command
    case dictation
    case confirm

    var endsOnPause: Bool { self != .dictation }
}

public enum EndReason: String, Sendable {
    case stopped
    case paused
    case silence
}

public enum SessionAction: Equatable, Sendable {
    case speech
    case level(Float)
    case segment([Float])
    case end(EndReason)
}

public struct ListenRules: Sendable {
    public static let sampleRate = 16_000
    public static let frameSamples = 512

    public var speechThreshold: Float = 0.5
    public var silenceThreshold: Float = 0.35
    public var commandPause: Double = 1.5
    public var dictationPause: Double = 0.8
    public var noSpeechLimit: Double = 30
    public var commandNoSpeechLimit: Double = 3
    public var segmentLimit: Double = 30
    public var preRoll: Double = 0.3

    public init() {}
}

public final class ListenSession {
    public let purpose: Purpose
    let rules: ListenRules
    private(set) public var ended = false
    private var heardSpeech = false
    private var inSpeech = false
    private var segment: [Float] = []
    private var recent: [Float] = []
    private var quietSeconds: Double = 0
    private var sinceSpeech: Double = 0

    public init(purpose: Purpose, rules: ListenRules = ListenRules()) {
        self.purpose = purpose
        self.rules = rules
    }

    private var frameSeconds: Double {
        Double(ListenRules.frameSamples) / Double(ListenRules.sampleRate)
    }

    private var noSpeechLimit: Double {
        purpose.endsOnPause ? rules.commandNoSpeechLimit : rules.noSpeechLimit
    }

    private var preRollSamples: Int {
        Int(rules.preRoll * Double(ListenRules.sampleRate))
    }

    private var segmentLimitSamples: Int {
        Int(rules.segmentLimit * Double(ListenRules.sampleRate))
    }

    public func feed(frame: [Float], probability: Float) -> [SessionAction] {
        guard !ended else { return [] }
        var actions: [SessionAction] = [.level(Self.level(frame))]
        if inSpeech {
            actions += continueSpeech(frame: frame, probability: probability)
        } else if probability >= rules.speechThreshold {
            actions += startSpeech(frame: frame)
        } else {
            keepRecent(frame)
            sinceSpeech += frameSeconds
            if sinceSpeech >= noSpeechLimit {
                actions.append(finish(.silence))
            }
        }
        return actions
    }

    public func stop() -> [SessionAction] {
        guard !ended else { return [] }
        return closeSegment() + [finish(.stopped)]
    }

    public func cancel() {
        ended = true
        segment = []
        recent = []
    }

    private func startSpeech(frame: [Float]) -> [SessionAction] {
        inSpeech = true
        quietSeconds = 0
        sinceSpeech = 0
        segment = recent + frame
        recent = []
        defer { heardSpeech = true }
        return heardSpeech ? [] : [.speech]
    }

    private func continueSpeech(frame: [Float], probability: Float) -> [SessionAction] {
        segment += frame
        if probability < rules.silenceThreshold {
            quietSeconds += frameSeconds
        } else {
            quietSeconds = 0
        }
        let pause = purpose.endsOnPause ? rules.commandPause : rules.dictationPause
        if quietSeconds >= pause {
            let quiet = quietSeconds
            let closed = closeSegment()
            sinceSpeech = quiet
            return purpose.endsOnPause ? closed + [finish(.paused)] : closed
        }
        if segment.count >= segmentLimitSamples {
            let cut = SessionAction.segment(segment)
            segment = []
            return [cut]
        }
        return []
    }

    private func closeSegment() -> [SessionAction] {
        inSpeech = false
        quietSeconds = 0
        let closed = segment
        segment = []
        return closed.isEmpty ? [] : [.segment(closed)]
    }

    private func finish(_ reason: EndReason) -> SessionAction {
        ended = true
        recent = []
        return .end(reason)
    }

    private func keepRecent(_ frame: [Float]) {
        recent += frame
        if recent.count > preRollSamples {
            recent.removeFirst(recent.count - preRollSamples)
        }
    }

    static func level(_ frame: [Float]) -> Float {
        guard !frame.isEmpty else { return 0 }
        let power = frame.reduce(Float(0)) { $0 + $1 * $1 } / Float(frame.count)
        return min(1, sqrt(power) * 8)
    }
}
