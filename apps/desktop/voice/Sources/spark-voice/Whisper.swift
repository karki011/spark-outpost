import CWhisper
import Foundation
import VoiceCore

private let quiet: @convention(c) (ggml_log_level, UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void = { _, _, _ in }

final class WhisperModel: SpeechModel {
    private let context: OpaquePointer
    private let detector: OpaquePointer
    private let work = DispatchQueue(label: "spark-voice.whisper")
    private let reply: DispatchQueue
    private let threads = Int32(max(1, min(4, ProcessInfo.processInfo.activeProcessorCount - 1)))

    static func silenceLogs() {
        whisper_log_set(quiet, nil)
    }

    init?(path: String, vad: String, reply: DispatchQueue) {
        var params = whisper_context_default_params()
        params.use_gpu = true
        params.flash_attn = true
        guard let context = whisper_init_from_file_with_params(path, params) else { return nil }
        var vadParams = whisper_vad_default_context_params()
        vadParams.n_threads = 1
        vadParams.use_gpu = false
        guard let detector = whisper_vad_init_from_file_with_params(vad, vadParams) else {
            whisper_free(context)
            return nil
        }
        self.context = context
        self.detector = detector
        self.reply = reply
    }

    deinit {
        whisper_vad_free(detector)
        whisper_free(context)
    }

    func resetDetector() {
        whisper_vad_reset_state(detector)
    }

    func probability(_ frame: [Float]) -> Float {
        let ok = frame.withUnsafeBufferPointer {
            whisper_vad_detect_speech_no_reset(detector, $0.baseAddress, Int32($0.count))
        }
        guard ok, whisper_vad_n_probs(detector) > 0, let probs = whisper_vad_probs(detector) else { return 0 }
        return probs[Int(whisper_vad_n_probs(detector)) - 1]
    }

    func transcribe(
        _ samples: [Float], language: String, hint: String, single: Bool,
        done: @escaping (String) -> Void
    ) {
        let padded = Self.padded(samples)
        work.async { [self] in
            let text = run(padded, language: language, hint: hint, single: single)
            reply.async { done(text) }
        }
    }

    private static func padded(_ samples: [Float]) -> [Float] {
        let minimum = Int(1.1 * Double(ListenRules.sampleRate))
        guard samples.count < minimum else { return samples }
        return samples + [Float](repeating: 0, count: minimum - samples.count)
    }

    private func run(_ samples: [Float], language: String, hint: String, single: Bool) -> String {
        language.withCString { languagePointer in
            hint.withCString { hintPointer in
                var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
                params.n_threads = threads
                params.language = languagePointer
                params.translate = false
                params.no_context = true
                params.no_timestamps = true
                params.single_segment = single
                params.print_progress = false
                params.print_realtime = false
                params.print_special = false
                params.print_timestamps = false
                params.suppress_blank = true
                params.suppress_nst = true
                if !hint.isEmpty { params.initial_prompt = hintPointer }
                let status = samples.withUnsafeBufferPointer {
                    whisper_full(context, params, $0.baseAddress, Int32($0.count))
                }
                guard status == 0 else { return "" }
                var text = ""
                for index in 0..<whisper_full_n_segments(context) {
                    if let segment = whisper_full_get_segment_text(context, index) {
                        text += String(cString: segment)
                    }
                }
                return text
            }
        }
    }
}
