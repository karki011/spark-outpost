import Foundation

public struct ListenRequest: Equatable, Sendable {
    public var purpose: Purpose
    public var language: String
    public var hint: String
    public var file: String?
}

public enum Request: Equatable, Sendable {
    case status
    case load(path: String, sha256: String, vad: String)
    case listen(ListenRequest)
    case stop
    case cancel
    case speak(text: String, voice: String?)
    case hush
    case keys(fn: Bool, hold: Bool)
}

public struct Envelope: Equatable, Sendable {
    public var id: String
    public var request: Request
}

public enum ErrorCode: String, Sendable {
    case invalid
    case micDenied = "mic_denied"
    case noInputDevice = "no_input_device"
    case modelMissing = "model_missing"
    case badModel = "bad_model"
    case busy
    case fileInputOff = "file_input_off"
    case failed
}

public struct HelperStatus: Equatable, Sendable {
    public var mic: String
    public var inputMonitoring: Bool
    public var model: Bool
    public var fnSetting: String
    public var arch: String

    public init(mic: String, inputMonitoring: Bool, model: Bool, fnSetting: String, arch: String) {
        self.mic = mic
        self.inputMonitoring = inputMonitoring
        self.model = model
        self.fnSetting = fnSetting
        self.arch = arch
    }
}

public enum Message: Equatable, Sendable {
    case status(HelperStatus)
    case loaded
    case level(Float)
    case speech
    case partial(String)
    case final(text: String, reason: EndReason)
    case cancelled
    case spoken
    case interrupted
    case hushed
    case keys
    case key(KeyEvent)
    case error(ErrorCode, String)
}

private func string(_ object: [String: Any], _ key: String) -> String? {
    object[key] as? String
}

public func parseRequest(_ line: String) -> Result<Envelope, ParseFailure> {
    guard let data = line.data(using: .utf8),
          let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let id = string(object, "id"), !id.isEmpty, id.count <= 100,
          let op = string(object, "op")
    else { return .failure(ParseFailure(id: nil)) }
    guard let request = request(op: op, object: object) else {
        return .failure(ParseFailure(id: id))
    }
    return .success(Envelope(id: id, request: request))
}

public struct ParseFailure: Error, Equatable {
    public var id: String?
}

private func request(op: String, object: [String: Any]) -> Request? {
    switch op {
    case "status": return .status
    case "stop": return .stop
    case "cancel": return .cancel
    case "hush": return .hush
    case "load":
        guard let path = string(object, "path"), let sha = string(object, "sha256"),
              let vad = string(object, "vad") else { return nil }
        return .load(path: path, sha256: sha.lowercased(), vad: vad)
    case "listen":
        guard let raw = string(object, "purpose"), let purpose = Purpose(rawValue: raw) else { return nil }
        return .listen(ListenRequest(
            purpose: purpose,
            language: string(object, "language") ?? "en",
            hint: String((string(object, "hint") ?? "").prefix(600)),
            file: string(object, "file")
        ))
    case "speak":
        guard let text = string(object, "text"), !text.isEmpty else { return nil }
        return .speak(text: String(text.prefix(4_000)), voice: string(object, "voice"))
    case "keys":
        return .keys(fn: object["fn"] as? Bool ?? false, hold: object["hold"] as? Bool ?? false)
    default:
        return nil
    }
}

public func encode(id: String?, _ message: Message) -> String {
    var object: [String: Any] = ["id": id ?? NSNull()]
    switch message {
    case .status(let status):
        object["event"] = "status"
        object["mic"] = status.mic
        object["inputMonitoring"] = status.inputMonitoring
        object["model"] = status.model
        object["fnSetting"] = status.fnSetting
        object["arch"] = status.arch
    case .loaded: object["event"] = "loaded"
    case .level(let level):
        object["event"] = "level"
        object["level"] = Double((level * 100).rounded() / 100)
    case .speech: object["event"] = "speech"
    case .partial(let text):
        object["event"] = "partial"
        object["text"] = text
    case .final(let text, let reason):
        object["event"] = "final"
        object["text"] = text
        object["reason"] = reason.rawValue
    case .cancelled: object["event"] = "cancelled"
    case .spoken: object["event"] = "spoken"
    case .interrupted: object["event"] = "interrupted"
    case .hushed: object["event"] = "hushed"
    case .keys: object["event"] = "keys"
    case .key(let key): object["event"] = key.rawValue
    case .error(let code, let detail):
        object["event"] = "error"
        object["error"] = code.rawValue
        object["detail"] = detail
    }
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
    return String(decoding: data, as: UTF8.self)
}
