import Foundation

public struct MeetingSegment: Equatable, Sendable {
    public var samples: [Float]
    public var startMs: Int
    public var endMs: Int
}

public final class MeetingStream {
    private let rules: ListenRules
    private var inSpeech = false
    private var segment: [Float] = []
    private var segmentStart = 0
    private var recent: [Float] = []
    private var quietSeconds: Double = 0
    private var position = 0

    public init(rules: ListenRules = ListenRules()) {
        self.rules = rules
    }

    private func samples(_ seconds: Double) -> Int {
        Int(seconds * Double(ListenRules.sampleRate))
    }

    private func milliseconds(_ sample: Int) -> Int {
        sample * 1_000 / ListenRules.sampleRate
    }

    public func feed(frame: [Float], probability: Float) -> MeetingSegment? {
        let start = position
        position += frame.count
        guard inSpeech else {
            if probability >= rules.speechThreshold {
                inSpeech = true
                quietSeconds = 0
                segmentStart = start - recent.count
                segment = recent + frame
                recent = []
            } else {
                keepRecent(frame)
            }
            return nil
        }
        segment += frame
        if probability < rules.silenceThreshold {
            quietSeconds += Double(frame.count) / Double(ListenRules.sampleRate)
        } else {
            quietSeconds = 0
        }
        if quietSeconds >= rules.dictationPause {
            inSpeech = false
            return take()
        }
        return segment.count >= samples(rules.meetingSegmentLimit) ? take() : nil
    }

    public func flush() -> MeetingSegment? {
        guard inSpeech else { return nil }
        inSpeech = false
        return take()
    }

    private func take() -> MeetingSegment? {
        let closed = MeetingSegment(
            samples: segment, startMs: milliseconds(segmentStart), endMs: milliseconds(position))
        segment = []
        segmentStart = position
        quietSeconds = 0
        return closed.samples.isEmpty ? nil : closed
    }

    private func keepRecent(_ frame: [Float]) {
        recent += frame
        let limit = samples(rules.preRoll)
        if recent.count > limit { recent.removeFirst(recent.count - limit) }
    }
}
