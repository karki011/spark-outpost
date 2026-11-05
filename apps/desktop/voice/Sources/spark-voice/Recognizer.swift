import CTranscribe
import Foundation

private func withOptionalCString<Result>(
    _ text: String?, _ body: (UnsafePointer<CChar>?) -> Result
) -> Result {
    guard let text else { return body(nil) }
    return text.withCString { body($0) }
}

final class Recognizer {
    private let model: OpaquePointer
    private let session: OpaquePointer
    private let languages: Set<String>
    private let whisper: Bool
    private let prompted: Bool

    init?(path: String, backend: transcribe_backend_request, threads: Int32) {
        var load = transcribe_model_load_params()
        transcribe_model_load_params_init(&load)
        load.backend = backend
        var model: OpaquePointer?
        guard transcribe_model_load_file(path, &load, &model) == TRANSCRIBE_OK, let model else { return nil }
        var params = transcribe_session_params()
        transcribe_session_params_init(&params)
        params.n_threads = threads
        var session: OpaquePointer?
        guard transcribe_session_init(model, &params, &session) == TRANSCRIBE_OK, let session else {
            transcribe_model_free(model)
            return nil
        }
        self.model = model
        self.session = session
        languages = Self.languages(of: model)
        whisper = transcribe_model_accepts_ext_kind(
            model, TRANSCRIBE_EXT_SLOT_RUN, TRANSCRIBE_EXT_KIND_WHISPER_RUN)
        prompted = whisper && transcribe_model_supports(model, TRANSCRIBE_FEATURE_INITIAL_PROMPT)
    }

    deinit {
        transcribe_session_free(session)
        transcribe_model_free(model)
    }

    private static func languages(of model: OpaquePointer) -> Set<String> {
        var capabilities = transcribe_capabilities()
        transcribe_capabilities_init(&capabilities)
        guard transcribe_model_get_capabilities(model, &capabilities) == TRANSCRIBE_OK,
              let list = capabilities.languages
        else { return [] }
        return Set((0..<Int(capabilities.n_languages)).compactMap { list[$0].map { String(cString: $0) } })
    }

    func supported(_ language: String) -> String? {
        languages.isEmpty || languages.contains(language) ? language : nil
    }

    func run(
        _ samples: [Float], language: String?, hint: String, draft: Bool
    ) -> (transcribe_status, String) {
        var params = transcribe_run_params()
        transcribe_run_params_init(&params)
        params.timestamps = TRANSCRIBE_TIMESTAMPS_NONE
        var options = transcribe_whisper_run_ext()
        transcribe_whisper_run_ext_init(&options)
        options.condition_on_prev_tokens = false
        if draft { options.temperature_inc = 0 }
        let prompt = prompted && !hint.isEmpty ? hint : nil
        let status = withOptionalCString(language) { languagePointer in
            withOptionalCString(prompt) { promptPointer in
                withUnsafeMutablePointer(to: &options) { pointer in
                    params.language = languagePointer
                    pointer.pointee.initial_prompt = promptPointer
                    if whisper {
                        params.family = UnsafeRawPointer(pointer).assumingMemoryBound(to: transcribe_ext.self)
                    }
                    return samples.withUnsafeBufferPointer {
                        transcribe_run(session, $0.baseAddress, Int32($0.count), &params)
                    }
                }
            }
        }
        guard status == TRANSCRIBE_OK, let text = transcribe_full_text(session) else { return (status, "") }
        return (status, String(cString: text))
    }
}
