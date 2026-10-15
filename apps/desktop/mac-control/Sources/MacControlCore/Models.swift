extension KeyedEncodingContainer {
    mutating func encodeNullable<Value: Encodable>(_ value: Value?, forKey key: Key) throws {
        if let value {
            try encode(value, forKey: key)
        } else {
            try encodeNil(forKey: key)
        }
    }
}

public struct Identity: Equatable, Codable {
    public var role: String
    public var subrole: String?
    public var title: String?
    public var description: String?
    public var identifier: String?

    public init(role: String, subrole: String?, title: String?, description: String?, identifier: String?) {
        self.role = clip(role, Limits.role)
        self.subrole = clipNonEmpty(subrole, Limits.role)
        self.title = clipNonEmpty(title, Limits.title)
        self.description = clipNonEmpty(description, Limits.title)
        self.identifier = clipNonEmpty(identifier, Limits.title)
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            role: try container.decode(String.self, forKey: .role),
            subrole: try container.decodeIfPresent(String.self, forKey: .subrole),
            title: try container.decodeIfPresent(String.self, forKey: .title),
            description: try container.decodeIfPresent(String.self, forKey: .description),
            identifier: try container.decodeIfPresent(String.self, forKey: .identifier)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(role, forKey: .role)
        try container.encodeNullable(subrole, forKey: .subrole)
        try container.encodeNullable(title, forKey: .title)
        try container.encodeNullable(description, forKey: .description)
        try container.encodeNullable(identifier, forKey: .identifier)
    }

    var isSecure: Bool {
        role == AXName.secureTextField || subrole == AXName.secureTextField
    }

    private enum CodingKeys: String, CodingKey {
        case role, subrole, title, description, identifier
    }
}

public struct WindowInfo: Equatable, Encodable {
    public var index: Int
    public var title: String?

    public init(index: Int, title: String?) {
        self.index = index
        self.title = clipNonEmpty(title, Limits.title)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(index, forKey: .index)
        try container.encodeNullable(title, forKey: .title)
    }

    private enum CodingKeys: String, CodingKey { case index, title }
}

public struct Signature: Equatable, Encodable {
    public var valid: Bool
    public var apple: Bool
    public var teamId: String?

    public init(valid: Bool, apple: Bool, teamId: String?) {
        self.valid = valid
        self.apple = apple
        self.teamId = clipNonEmpty(teamId, Limits.teamId)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(valid, forKey: .valid)
        try container.encode(apple, forKey: .apple)
        try container.encodeNullable(teamId, forKey: .teamId)
    }

    private enum CodingKeys: String, CodingKey { case valid, apple, teamId }
}

public struct RunningApp: Equatable {
    public var pid: Int32
    public var name: String
    public var bundleId: String?
    public var path: String?
    public var frontmost: Bool
    public var signature: Signature

    public init(pid: Int32, name: String?, bundleId: String?, path: String?, frontmost: Bool, signature: Signature) {
        self.pid = pid
        self.bundleId = clipNonEmpty(bundleId, Limits.bundleId)
        self.name = clip(name ?? bundleId ?? "", Limits.appName)
        self.path = clipNonEmpty(path, Limits.path)
        self.frontmost = frontmost
        self.signature = signature
    }
}

public struct AppEntry: Equatable, Encodable {
    public var app: RunningApp
    public var windows: [WindowInfo]

    public init(app: RunningApp, windows: [WindowInfo]) {
        self.app = app
        self.windows = Array(windows.prefix(Limits.windows))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(app.pid, forKey: .pid)
        try container.encode(app.name, forKey: .name)
        try container.encodeNullable(app.bundleId, forKey: .bundleId)
        try container.encodeNullable(app.path, forKey: .path)
        try container.encode(app.frontmost, forKey: .frontmost)
        try container.encode(app.signature, forKey: .signature)
        try container.encode(windows, forKey: .windows)
    }

    private enum CodingKeys: String, CodingKey {
        case pid, name, bundleId, path, frontmost, signature, windows
    }
}

public struct SessionStatus: Equatable, Encodable {
    public var trusted: Bool
    public var locked: Bool
    public var secureInput: Bool
    public var idleSeconds: Double
    public var frontmostPid: Int32?

    public init(trusted: Bool, locked: Bool, secureInput: Bool, idleSeconds: Double, frontmostPid: Int32?) {
        self.trusted = trusted
        self.locked = locked
        self.secureInput = secureInput
        self.idleSeconds = idleSeconds.isFinite ? max(0, idleSeconds) : 0
        self.frontmostPid = frontmostPid.flatMap { $0 > 0 ? $0 : nil }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(trusted, forKey: .trusted)
        try container.encode(locked, forKey: .locked)
        try container.encode(secureInput, forKey: .secureInput)
        try container.encode(idleSeconds, forKey: .idleSeconds)
        try container.encodeNullable(frontmostPid, forKey: .frontmostPid)
    }

    private enum CodingKeys: String, CodingKey {
        case trusted, locked, secureInput, idleSeconds, frontmostPid
    }
}
