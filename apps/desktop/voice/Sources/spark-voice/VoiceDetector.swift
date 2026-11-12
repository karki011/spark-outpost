import CTranscribe
import Foundation
import VoiceCore

final class VoiceDetector: SpeechDetector {
    private let model: OpaquePointer
    private let session: OpaquePointer

    init?(path: String) {
        var load = transcribe_model_load_params()
        transcribe_model_load_params_init(&load)
        load.backend = TRANSCRIBE_BACKEND_CPU
        var model: OpaquePointer?
        guard transcribe_model_load_file(path, &load, &model) == TRANSCRIBE_OK, let model else { return nil }
        var params = transcribe_vad_session_params()
        transcribe_vad_session_params_init(&params)
        params.n_threads = 1
        var session: OpaquePointer?
        guard transcribe_vad_session_init(model, &params, &session) == TRANSCRIBE_OK, let session else {
            transcribe_model_free(model)
            return nil
        }
        self.model = model
        self.session = session
    }

    deinit {
        transcribe_vad_session_free(session)
        transcribe_model_free(model)
    }

    func reset() {
        transcribe_vad_stream_reset(session)
    }

    func probability(_ frame: [Float]) -> Float {
        let fed = frame.withUnsafeBufferPointer {
            transcribe_vad_stream_feed(session, $0.baseAddress, Int32($0.count))
        }
        var result = transcribe_vad_result()
        transcribe_vad_result_init(&result)
        guard fed == TRANSCRIBE_OK, transcribe_vad_get_result(session, &result) == TRANSCRIBE_OK,
              result.n_probs > 0, let probs = transcribe_vad_probs(session)
        else { return 0 }
        return probs[Int(result.n_probs) - 1]
    }
}
