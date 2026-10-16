import Foundation

public final class Engine {
    public typealias Emit = (String?, Message) -> Void

    private let platform: Platform
    private let emit: Emit
    private let rules: ListenRules
    private var model: SpeechModel?
    private var listening: Listening?
    private var speaking: String?
    private var generation = 0

    private final class Listening {
        let id: String
        let request: ListenRequest
        let session: ListenSession
        let generation: Int
        var pending = 0
        var texts: [String] = []
        var reason: EndReason?
        var leftover: [Float] = []

        init(id: String, request: ListenRequest, session: ListenSession, generation: Int) {
            self.id = id
            self.request = request
            self.session = session
            self.generation = generation
        }

        var text: String { cleanTranscript(texts.joined(separator: " ")) }
    }

    public init(platform: Platform, rules: ListenRules = ListenRules(), emit: @escaping Emit) {
        self.platform = platform
        self.rules = rules
        self.emit = emit
    }

    public var isListening: Bool { listening != nil }

    public func handle(line: String) {
        switch parseRequest(line) {
        case .failure(let failure):
            emit(failure.id, .error(.invalid, "not a request this helper knows"))
        case .success(let envelope):
            handle(envelope)
        }
    }

    public func handle(_ envelope: Envelope) {
        let id = envelope.id
        switch envelope.request {
        case .status:
            var status = platform.status()
            status.model = model != nil
            emit(id, .status(status))
        case .load(let path, let sha, let vad):
            load(id: id, path: path, sha: sha, vad: vad)
        case .listen(let request):
            listen(id: id, request: request)
        case .stop:
            guard let current = listening, current.id == id else { return }
            apply(current.session.stop(), to: current)
        case .cancel:
            cancel(id: id)
        case .speak(let text, let voice):
            speak(id: id, text: text, voice: voice)
        case .hush:
            hush()
            emit(id, .hushed)
        case .keys(let fn, let hold):
            let watching = platform.watchKeys(fn: fn, hold: hold) { [weak self] key in
                self?.emit(id, .key(key))
            }
            emit(id, watching || !fn ? .keys : .error(.failed, "Input Monitoring is not allowed"))
        }
    }

    private func load(id: String, path: String, sha: String, vad: String) {
        guard sha256(ofFile: path) == sha else {
            emit(id, .error(.badModel, "the model file does not match its sha256"))
            return
        }
        guard let loaded = platform.loadModel(path: path, vad: vad) else {
            emit(id, .error(.badModel, "the model could not be loaded"))
            return
        }
        model = loaded
        emit(id, .loaded)
    }

    private func listen(id: String, request: ListenRequest) {
        guard listening == nil else {
            emit(id, .error(.busy, "already listening"))
            return
        }
        guard let model else {
            emit(id, .error(.modelMissing, "load a model first"))
            return
        }
        if request.file != nil && !platform.fileInputAllowed {
            emit(id, .error(.fileInputOff, "file input is for tests"))
            return
        }
        hush()
        generation += 1
        model.resetDetector()
        let current = Listening(
            id: id, request: request,
            session: ListenSession(purpose: request.purpose, rules: rules),
            generation: generation)
        listening = current
        let failure = platform.startInput(
            file: request.file,
            onFrames: { [weak self, weak current] samples in
                guard let self, let current else { return }
                self.take(samples, for: current)
            },
            onEnd: { [weak self, weak current] in
                guard let self, let current else { return }
                self.apply(current.session.stop(), to: current)
            })
        if let failure {
            listening = nil
            emit(id, .error(failure, "the microphone could not start"))
        }
    }

    private func take(_ samples: [Float], for current: Listening) {
        guard listening === current, let model else { return }
        var buffer = current.leftover + samples
        let size = ListenRules.frameSamples
        var start = 0
        while buffer.count - start >= size, listening === current {
            let frame = Array(buffer[start..<(start + size)])
            start += size
            apply(current.session.feed(frame: frame, probability: model.probability(frame)), to: current)
        }
        buffer.removeFirst(min(start, buffer.count))
        current.leftover = buffer
    }

    private func apply(_ actions: [SessionAction], to current: Listening) {
        for action in actions {
            switch action {
            case .level(let level): emit(current.id, .level(level))
            case .speech: emit(current.id, .speech)
            case .segment(let samples): transcribe(samples, for: current)
            case .end(let reason):
                current.reason = reason
                platform.stopInput()
                finishIfDone(current)
            }
        }
    }

    private func transcribe(_ samples: [Float], for current: Listening) {
        guard let model else { return }
        current.pending += 1
        let request = current.request
        model.transcribe(
            samples, language: request.language, hint: request.hint,
            single: request.purpose != .dictation
        ) { [weak self] text in
            guard let self, current.generation == self.generation else { return }
            current.pending -= 1
            let cleaned = cleanTranscript(text)
            if !cleaned.isEmpty { current.texts.append(cleaned) }
            if request.purpose == .dictation && current.reason == nil && !cleaned.isEmpty {
                self.emit(current.id, .partial(current.text))
            }
            self.finishIfDone(current)
        }
    }

    private func finishIfDone(_ current: Listening) {
        guard let reason = current.reason, current.pending == 0, listening === current else { return }
        listening = nil
        emit(current.id, .final(text: current.text, reason: reason))
    }

    private func cancel(id: String) {
        guard let current = listening, current.id == id else { return }
        current.session.cancel()
        listening = nil
        generation += 1
        platform.stopInput()
        emit(id, .cancelled)
    }

    private func speak(id: String, text: String, voice: String?) {
        guard listening == nil else {
            emit(id, .error(.busy, "listening"))
            return
        }
        hush()
        speaking = id
        platform.speak(text: text, voice: voice) { [weak self] interrupted in
            guard let self else { return }
            if self.speaking == id { self.speaking = nil }
            self.emit(id, interrupted ? .interrupted : .spoken)
        }
    }

    private func hush() {
        guard speaking != nil else { return }
        speaking = nil
        platform.hush()
    }
}
