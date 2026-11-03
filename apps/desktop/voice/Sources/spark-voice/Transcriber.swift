import CTranscribe
import Foundation
import VoiceCore

final class Transcriber: SpeechModel {
    private let path: String
    private var recognizer: Recognizer
    private let detector: VoiceDetector
    private let work = DispatchQueue(label: "spark-voice.transcribe")
    private let reply: DispatchQueue
    private static let threads = Int32(max(1, min(4, ProcessInfo.processInfo.activeProcessorCount - 1)))

    static func silenceLogs() {
        transcribe_log_set(nil, nil)
    }

    init?(path: String, vad: String, reply: DispatchQueue) {
        guard let detector = VoiceDetector(path: vad),
              let recognizer = Recognizer(path: path, backend: TRANSCRIBE_BACKEND_AUTO, threads: Self.threads)
        else { return nil }
        self.path = path
        self.recognizer = recognizer
        self.detector = detector
        self.reply = reply
    }

    func resetDetector() {
        detector.reset()
    }

    func probability(_ frame: [Float]) -> Float {
        detector.probability(frame)
    }

    func transcribe(
        _ samples: [Float], language: String, hint: String, draft: Bool,
        done: @escaping (String) -> Void
    ) {
        let padded = Self.padded(samples)
        work.async { [self] in
            let text = run(padded, language: language, hint: hint, draft: draft)
            reply.async { done(text) }
        }
    }

    private static func padded(_ samples: [Float]) -> [Float] {
        let minimum = Int(1.1 * Double(ListenRules.sampleRate))
        guard samples.count < minimum else { return samples }
        return samples + [Float](repeating: 0, count: minimum - samples.count)
    }

    private func run(_ samples: [Float], language: String, hint: String, draft: Bool) -> String {
        let (status, text) = recognizer.run(
            samples, language: recognizer.supported(language), hint: hint, draft: draft)
        guard status == TRANSCRIBE_ERR_BACKEND,
              let cpu = Recognizer(path: path, backend: TRANSCRIBE_BACKEND_CPU, threads: Self.threads)
        else { return text }
        recognizer = cpu
        return cpu.run(samples, language: cpu.supported(language), hint: hint, draft: draft).1
    }
}
