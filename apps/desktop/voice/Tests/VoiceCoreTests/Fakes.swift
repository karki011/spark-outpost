import Foundation
@testable import VoiceCore

let frameSeconds = Double(ListenRules.frameSamples) / Double(ListenRules.sampleRate)

func frames(seconds: Double, speech: Bool) -> [Float] {
    let count = Int((seconds / frameSeconds).rounded()) * ListenRules.frameSamples
    return [Float](repeating: speech ? 0.5 : 0, count: count)
}

final class FakeDetector: SpeechDetector {
    func reset() {}

    func probability(_ frame: [Float]) -> Float { (frame.first ?? 0) > 0.25 ? 0.9 : 0.05 }
}

final class FakeModel: SpeechModel {
    var detectorsMade = 0
    var detectorFails = false

    func makeDetector() -> SpeechDetector? {
        guard !detectorFails else { return nil }
        detectorsMade += 1
        return FakeDetector()
    }

    var transcribed: [Int] = []
    var drafted: [Int] = []
    var draftText: String?
    var deferred: [() -> Void] = []
    var holdTranscripts = false
    var resets = 0

    func resetDetector() { resets += 1 }

    func probability(_ frame: [Float]) -> Float { (frame.first ?? 0) > 0.25 ? 0.9 : 0.05 }

    func transcribe(
        _ samples: [Float], language: String, hint: String, draft: Bool,
        done: @escaping (String) -> Void
    ) {
        let text: String
        if draft {
            drafted.append(samples.count)
            text = draftText ?? "draft\(drafted.count)"
        } else {
            transcribed.append(samples.count)
            text = "part\(transcribed.count)"
        }
        if holdTranscripts { deferred.append { done(text) } } else { done(text) }
    }
}

final class FakePlatform: Platform {
    var fileInputAllowed = false
    var model = FakeModel()
    var onFrames: (([Float]) -> Void)?
    var onEnd: (() -> Void)?
    var inputStops = 0
    var hushes = 0
    var startFailure: ErrorCode?
    var speakDone: ((Bool) -> Void)?
    var onKey: ((KeyEvent) -> Void)?
    var keysAllowed = true

    func status() -> HelperStatus {
        HelperStatus(mic: "granted", inputMonitoring: false, model: false, fnSetting: "free", arch: "arm64")
    }

    func loadModel(path: String, vad: String) -> SpeechModel? { model }

    func startInput(
        file: String?, onFrames: @escaping ([Float]) -> Void, onEnd: @escaping () -> Void
    ) -> ErrorCode? {
        if let startFailure { return startFailure }
        self.onFrames = onFrames
        self.onEnd = onEnd
        return nil
    }

    func stopInput() { inputStops += 1 }

    var onSystemFrames: (([Float]) -> Void)?
    var onSystemState: ((Bool) -> Void)?
    var systemStops = 0

    func startSystemAudio(
        file: String?, onFrames: @escaping ([Float]) -> Void, onState: @escaping (Bool) -> Void
    ) {
        onSystemFrames = onFrames
        onSystemState = onState
    }

    func stopSystemAudio() { systemStops += 1 }

    func speak(text: String, voice: String?, done: @escaping (Bool) -> Void) { speakDone = done }

    func hush() {
        hushes += 1
        let done = speakDone
        speakDone = nil
        done?(true)
    }

    func watchKeys(fn: Bool, hold: Bool, onKey: @escaping (KeyEvent) -> Void) -> Bool {
        self.onKey = onKey
        return keysAllowed
    }
}

final class Scene {
    let platform = FakePlatform()
    var sent: [(String?, Message)] = []
    lazy var engine = Engine(platform: platform) { [unowned self] id, message in
        self.sent.append((id, message))
    }
    let modelPath: String

    init() {
        modelPath = NSTemporaryDirectory() + "voice-model-\(UUID().uuidString).bin"
        FileManager.default.createFile(atPath: modelPath, contents: Data("model".utf8))
    }

    deinit { try? FileManager.default.removeItem(atPath: modelPath) }

    var modelSha: String { sha256(ofFile: modelPath)! }

    func send(_ json: String) { engine.handle(line: json) }

    func loaded() -> Scene {
        send(#"{"id":"l","op":"load","path":"\#(modelPath)","sha256":"\#(modelSha)","vad":"v"}"#)
        sent = []
        return self
    }

    func play(_ samples: [Float]) { platform.onFrames?(samples) }

    func playOthers(_ samples: [Float]) { platform.onSystemFrames?(samples) }

    var events: [Message] { sent.map(\.1).filter { if case .level = $0 { return false } else { return true } } }
}
