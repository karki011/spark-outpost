import Foundation

final class MeetingRecorder {
    typealias Emit = (String?, Message) -> Void

    private final class Lane {
        let source: MeetingSource
        let detector: SpeechDetector
        let stream: MeetingStream
        var leftover: [Float] = []

        init(source: MeetingSource, detector: SpeechDetector, rules: ListenRules) {
            self.source = source
            self.detector = detector
            stream = MeetingStream(rules: rules)
        }
    }

    private final class Recording {
        let id: String
        let language: String
        let model: SpeechModel
        let generation: Int
        let lanes: [MeetingSource: Lane]
        var pending = 0
        var stopping = false

        init(id: String, language: String, model: SpeechModel, generation: Int, lanes: [Lane]) {
            self.id = id
            self.language = language
            self.model = model
            self.generation = generation
            self.lanes = Dictionary(uniqueKeysWithValues: lanes.map { ($0.source, $0) })
        }
    }

    private let platform: Platform
    private let rules: ListenRules
    private let emit: Emit
    private var recording: Recording?
    private var generation = 0

    init(platform: Platform, rules: ListenRules, emit: @escaping Emit) {
        self.platform = platform
        self.rules = rules
        self.emit = emit
    }

    var isRecording: Bool { recording != nil }

    func start(id: String, request: MeetingRequest, model: SpeechModel) {
        guard recording == nil else {
            emit(id, .error(.busy, "already recording a meeting"))
            return
        }
        if (request.file != nil || request.systemFile != nil) && !platform.fileInputAllowed {
            emit(id, .error(.fileInputOff, "file input is for tests"))
            return
        }
        guard let mine = model.makeDetector(), let theirs = model.makeDetector() else {
            emit(id, .error(.failed, "the voice detector could not start"))
            return
        }
        generation += 1
        let current = Recording(
            id: id, language: request.language, model: model, generation: generation,
            lanes: [
                Lane(source: .you, detector: mine, rules: rules),
                Lane(source: .others, detector: theirs, rules: rules),
            ])
        recording = current
        let failure = platform.startInput(
            file: request.file,
            onFrames: { [weak self, weak current] samples in
                guard let self, let current else { return }
                self.take(samples, from: .you, for: current)
            },
            onEnd: {})
        if let failure {
            recording = nil
            emit(id, .error(failure, "the microphone could not start"))
            return
        }
        emit(id, .meetingStarted)
        platform.startSystemAudio(
            file: request.systemFile,
            onFrames: { [weak self, weak current] samples in
                guard let self, let current else { return }
                self.take(samples, from: .others, for: current)
            },
            onState: { [weak self, weak current] on in
                guard let self, let current, self.recording === current, !current.stopping else { return }
                self.emit(current.id, .meetingSystem(on))
            })
    }

    func stop(id: String) {
        guard let current = recording, current.id == id, !current.stopping else { return }
        current.stopping = true
        platform.stopInput()
        platform.stopSystemAudio()
        for source in [MeetingSource.you, .others] {
            guard let lane = current.lanes[source], let segment = lane.stream.flush() else { continue }
            transcribe(segment, from: source, for: current)
        }
        finishIfDone(current)
    }

    private func take(_ samples: [Float], from source: MeetingSource, for current: Recording) {
        guard recording === current, !current.stopping, let lane = current.lanes[source] else { return }
        var buffer = lane.leftover + samples
        let size = ListenRules.frameSamples
        var start = 0
        while buffer.count - start >= size {
            let frame = Array(buffer[start..<(start + size)])
            start += size
            let probability = lane.detector.probability(frame)
            if let segment = lane.stream.feed(frame: frame, probability: probability) {
                transcribe(segment, from: source, for: current)
            }
        }
        buffer.removeFirst(min(start, buffer.count))
        lane.leftover = buffer
    }

    private func transcribe(_ segment: MeetingSegment, from source: MeetingSource, for current: Recording) {
        current.pending += 1
        current.model.transcribe(segment.samples, language: current.language, hint: "", draft: false) {
            [weak self] text in
            guard let self, current.generation == self.generation, self.recording === current else { return }
            current.pending -= 1
            let cleaned = cleanTranscript(text)
            if !cleaned.isEmpty {
                self.emit(
                    current.id,
                    .meetingLine(
                        source: source, text: cleaned, startMs: segment.startMs, endMs: segment.endMs))
            }
            self.finishIfDone(current)
        }
    }

    private func finishIfDone(_ current: Recording) {
        guard current.stopping, current.pending == 0, recording === current else { return }
        recording = nil
        emit(current.id, .meetingEnded)
    }
}
