public struct Node: Equatable, Encodable {
    public var ref: String
    public var depth: Int
    public var identity: Identity
    public var value: String?
    public var enabled: Bool
    public var focused: Bool
    public var secure: Bool
    public var actions: [String]

    public func encode(to encoder: Encoder) throws {
        try identity.encode(to: encoder)
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(ref, forKey: .ref)
        try container.encode(depth, forKey: .depth)
        try container.encodeNullable(value, forKey: .value)
        try container.encode(enabled, forKey: .enabled)
        try container.encode(focused, forKey: .focused)
        try container.encode(secure, forKey: .secure)
        try container.encode(actions, forKey: .actions)
    }

    private enum CodingKeys: String, CodingKey {
        case ref, depth, value, enabled, focused, secure, actions
    }
}

public enum ReadScope: String, Encodable {
    case window, sheet, menu, ref
}

public struct ReadResult: Equatable, Encodable {
    public var window: WindowInfo
    public var scope: ReadScope
    public var rootRef: String
    public var nodes: [Node]
    public var truncated: Bool
}

public enum TargetState: String, Encodable {
    case alive, gone, refound
}

public struct Target: Equatable, Encodable {
    public var ref: String
    public var state: TargetState
    public var pid: Int32
    public var window: WindowInfo?
    public var identity: Identity
    public var ancestors: [String]
    public var actions: [String]
    public var secure: Bool

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(ref, forKey: .ref)
        try container.encode(state, forKey: .state)
        try container.encode(pid, forKey: .pid)
        try container.encodeNullable(window, forKey: .window)
        try container.encode(identity, forKey: .identity)
        try container.encode(ancestors, forKey: .ancestors)
        try container.encode(actions, forKey: .actions)
        try container.encode(secure, forKey: .secure)
    }

    private enum CodingKeys: String, CodingKey {
        case ref, state, pid, window, identity, ancestors, actions, secure
    }
}

public enum OpResult: Equatable, Encodable {
    case status(SessionStatus)
    case trusted(Bool)
    case apps([AppEntry])
    case read(ReadResult)
    case target(Target)
    case focused(Target?)
    case done
    case pid(Int32)

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .status(let status):
            try status.encode(to: encoder)
        case .trusted(let trusted):
            var container = encoder.container(keyedBy: Keys.self)
            try container.encode(trusted, forKey: .trusted)
        case .apps(let apps):
            var container = encoder.container(keyedBy: Keys.self)
            try container.encode(apps, forKey: .apps)
        case .read(let read):
            try read.encode(to: encoder)
        case .target(let target):
            try target.encode(to: encoder)
        case .focused(let target):
            var container = encoder.singleValueContainer()
            if let target { try container.encode(target) } else { try container.encodeNil() }
        case .done:
            var container = encoder.container(keyedBy: Keys.self)
            try container.encode(true, forKey: .done)
        case .pid(let pid):
            var container = encoder.container(keyedBy: Keys.self)
            try container.encode(pid, forKey: .pid)
        }
    }

    private enum Keys: String, CodingKey { case trusted, apps, done, pid }
}

public enum ErrorCode: String, Encodable {
    case notTrusted = "not_trusted"
    case noApp = "no_app"
    case noWindow = "no_window"
    case gone
    case changed
    case notPressable = "not_pressable"
    case notFound = "not_found"
    case axFailed = "ax_failed"
    case invalid
}

public struct OpError: Error, Equatable {
    public var code: ErrorCode
    public var message: String

    public init(_ code: ErrorCode, _ message: String) {
        self.code = code
        self.message = message
    }
}
