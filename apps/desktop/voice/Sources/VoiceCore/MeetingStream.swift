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
    private var draftedAt = 0
    public private(set) var turn = 0

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
        if segment.count >= samples(rules.meetingSegmentLimit) { return take() }
        let atABreath = quietSeconds > 0 && segment.count >= samples(rules.meetingSoftLimit)
        return atABreath ? take() : nil
    }

    public var openStartMs: Int? { inSpeech ? milliseconds(segmentStart) : nil }

    public func draft() -> [Float]? {
        guard inSpeech, quietSeconds == 0,
              segment.count >= samples(rules.interimMinimum),
              segment.count - draftedAt >= samples(rules.interimEvery)
        else { return nil }
        draftedAt = segment.count
        return segment
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
        draftedAt = 0
        turn += 1
        return closed.samples.isEmpty ? nil : closed
    }

    private func keepRecent(_ frame: [Float]) {
        recent += frame
        let limit = samples(rules.preRoll)
        if recent.count > limit { recent.removeFirst(recent.count - limit) }
    }
}
