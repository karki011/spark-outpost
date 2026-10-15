import Foundation

public enum RequestedScope: String, Equatable {
    case window, sheet, menu
}

public enum HelperKey: String, Equatable {
    case space, returnKey = "return", enter
}

public enum ScrollDirection: String, Equatable {
    case up, down, left, right
}

public enum Request: Equatable {
    case status
    case prompt
    case apps
    case read(pid: Int32, window: Int?, ref: String?, scope: RequestedScope?)
    case target(ref: String, refind: Bool)
    case focused(pid: Int32)
    case menu(pid: Int32, path: [String])
    case press(ref: String, expect: Identity)
    case key(ref: String, key: HelperKey, expect: Identity)
    case scroll(pid: Int32, ref: String?, direction: ScrollDirection)
    case open(bundleId: String)
}

public enum ParsedLine: Equatable {
    case request(id: String, Request)
    case invalid(id: String, message: String)
    case ignored
}

private struct IdOnly: Decodable {
    let id: String
}

private struct RawRequest: Decodable {
    let op: String
    let pid: Int?
    let window: Int?
    let ref: String?
    let scope: String?
    let refind: Bool?
    let path: [String]?
    let expect: Identity?
    let key: String?
    let direction: String?
    let bundleId: String?
}

private struct InvalidRequest: Error {
    let message: String
}

public func parseRequestLine(_ line: String) -> ParsedLine {
    let data = Data(line.utf8)
    let decoder = JSONDecoder()
    guard let id = try? decoder.decode(IdOnly.self, from: data).id else { return .ignored }
    do {
        let raw = try decoder.decode(RawRequest.self, from: data)
        return .request(id: id, try request(from: raw))
    } catch let invalid as InvalidRequest {
        return .invalid(id: id, message: invalid.message)
    } catch {
        return .invalid(id: id, message: "malformed request")
    }
}

private func request(from raw: RawRequest) throws -> Request {
    switch raw.op {
    case "status": return .status
    case "prompt": return .prompt
    case "apps": return .apps
    case "read":
        return .read(pid: try pid(raw.pid), window: try windowIndex(raw.window), ref: try optionalRef(raw.ref), scope: try scope(raw.scope))
    case "target":
        return .target(ref: try ref(raw.ref), refind: try required(raw.refind, "refind"))
    case "focused":
        return .focused(pid: try pid(raw.pid))
    case "menu":
        return .menu(pid: try pid(raw.pid), path: try menuPath(raw.path))
    case "press":
        return .press(ref: try ref(raw.ref), expect: try required(raw.expect, "expect"))
    case "key":
        return .key(ref: try ref(raw.ref), key: try enumValue(raw.key, "key"), expect: try required(raw.expect, "expect"))
    case "scroll":
        return .scroll(pid: try pid(raw.pid), ref: try optionalRef(raw.ref), direction: try enumValue(raw.direction, "direction"))
    case "open":
        return .open(bundleId: try bundleId(raw.bundleId))
    default:
        throw InvalidRequest(message: "unknown op")
    }
}

private func required<Value>(_ value: Value?, _ name: String) throws -> Value {
    guard let value else { throw InvalidRequest(message: "missing \(name)") }
    return value
}

private func pid(_ value: Int?) throws -> Int32 {
    let pid = try required(value, "pid")
    guard pid > 0, pid <= Int(Int32.max) else { throw InvalidRequest(message: "invalid pid") }
    return Int32(pid)
}

private func windowIndex(_ value: Int?) throws -> Int? {
    guard let value else { return nil }
    guard value >= 0 else { throw InvalidRequest(message: "invalid window") }
    return value
}

private func ref(_ value: String?) throws -> String {
    let ref = try required(value, "ref")
    guard isValidRef(ref) else { throw InvalidRequest(message: "invalid ref") }
    return ref
}

private func optionalRef(_ value: String?) throws -> String? {
    guard let value else { return nil }
    return try ref(value)
}

private func scope(_ value: String?) throws -> RequestedScope? {
    guard let value else { return nil }
    guard let scope = RequestedScope(rawValue: value) else { throw InvalidRequest(message: "invalid scope") }
    return scope
}

private func enumValue<Value: RawRepresentable>(_ value: String?, _ name: String) throws -> Value where Value.RawValue == String {
    guard let parsed = Value(rawValue: try required(value, name)) else {
        throw InvalidRequest(message: "invalid \(name)")
    }
    return parsed
}

private func menuPath(_ value: [String]?) throws -> [String] {
    let path = try required(value, "path")
    let validSteps = path.allSatisfy { !$0.isEmpty && $0.utf16.count <= 200 }
    guard (1...8).contains(path.count), validSteps else { throw InvalidRequest(message: "invalid path") }
    return path
}

private func bundleId(_ value: String?) throws -> String {
    let bundleId = try required(value, "bundleId")
    guard !bundleId.isEmpty, bundleId.utf16.count <= Limits.bundleId else {
        throw InvalidRequest(message: "invalid bundleId")
    }
    return bundleId
}
