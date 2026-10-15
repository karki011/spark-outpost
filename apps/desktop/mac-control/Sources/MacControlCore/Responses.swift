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
    let id: String
    let ok = false
    let code: ErrorCode
    let message: String
}

private let responseEncoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    return encoder
}()

public func successLine(id: String, result: OpResult) -> String {
    do {
        let data = try responseEncoder.encode(SuccessResponse(id: id, result: result))
        return String(decoding: data, as: UTF8.self)
    } catch {
        return failureLine(id: id, error: OpError(.axFailed, "could not encode the result"))
    }
}

public func failureLine(id: String, error: OpError) -> String {
    let response = FailureResponse(id: id, code: error.code, message: clip(error.message, Limits.message))
    guard let data = try? responseEncoder.encode(response) else {
        return #"{"id":"","ok":false,"code":"ax_failed","message":"could not encode the error"}"#
    }
    return String(decoding: data, as: UTF8.self)
}

public func responseLine<System: SystemSource, Source: AXSource>(for line: String, engine: Engine<System, Source>) -> String? {
    switch parseRequestLine(line) {
    case .ignored:
        return nil
    case .invalid(let id, let message):
        return failureLine(id: id, error: OpError(.invalid, message))
    case .request(let id, let request):
        do {
            return successLine(id: id, result: try engine.handle(request))
        } catch let error as OpError {
            return failureLine(id: id, error: error)
        } catch let failure as AXFailure {
            return failureLine(id: id, error: OpError(.axFailed, failure.message))
        } catch {
            return failureLine(id: id, error: OpError(.axFailed, "accessibility call failed"))
        }
    }
}
