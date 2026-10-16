import Foundation

private struct SuccessResponse: Encodable {
    let id: String
    let result: OpResult

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(true, forKey: .ok)
        try container.encode(result, forKey: .result)
    }

    private enum CodingKeys: String, CodingKey { case id, ok, result }
}

private struct FailureResponse: Encodable {
    let id: String?
    let code: ErrorCode
    let message: String

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeNullable(id, forKey: .id)
        try container.encode(false, forKey: .ok)
        try container.encode(code, forKey: .code)
        try container.encode(message, forKey: .message)
    }

    private enum CodingKeys: String, CodingKey { case id, ok, code, message }
}

private let responseEncoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes, .sortedKeys]
    return encoder
}()

public let changedLine = #"{"event":"changed"}"#

public func successLine(id: String, result: OpResult) -> String {
    do {
        let data = try responseEncoder.encode(SuccessResponse(id: id, result: result))
        return String(decoding: data, as: UTF8.self)
    } catch {
        return failureLine(id: id, error: OpError(.failed, "could not encode the result"))
    }
}

public func failureLine(id: String?, error: OpError) -> String {
    let response = FailureResponse(id: id, code: error.code, message: clip(error.message, Limits.message))
    guard let data = try? responseEncoder.encode(response) else {
        return #"{"id":null,"ok":false,"code":"failed","message":"could not encode the error"}"#
    }
    return String(decoding: data, as: UTF8.self)
}

public func respond(to line: String, engine: Engine, write: @escaping (String) -> Void) {
    switch parseRequestLine(line) {
    case .invalid(let id, let message):
        write(failureLine(id: id, error: OpError(.invalid, message)))
    case .request(let id, let request):
        engine.handle(request) { result in
            switch result {
            case .success(let value): write(successLine(id: id, result: value))
            case .failure(let error): write(failureLine(id: id, error: error))
            }
        }
    }
}
