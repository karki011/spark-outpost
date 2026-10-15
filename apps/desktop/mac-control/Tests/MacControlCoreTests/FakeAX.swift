@testable import MacControlCore

final class FakeNode: Hashable {
    var role: String
    var subrole: String?
    var title: String?
    var description: String?
    var identifier: String?
    var value: String?
    var number: Double?
    var enabled = true
    var focused = false
    var actions: [String] = []
    var children: [FakeNode] = []
    var windows: [FakeNode] = []
    weak var parent: FakeNode?
    var alive = true
    var related: [ElementAttribute: FakeNode] = [:]

    init(_ role: String, title: String? = nil, subrole: String? = nil, identifier: String? = nil, actions: [String] = []) {
        self.role = role
        self.title = title
        self.subrole = subrole
        self.identifier = identifier
        self.actions = actions
    }

    @discardableResult
    func add(_ child: FakeNode) -> FakeNode {
        child.parent = self
        children.append(child)
        return child
    }

    func kill() {
        alive = false
        children.forEach { $0.kill() }
        parent?.children.removeAll { $0 === self }
        parent?.windows.removeAll { $0 === self }
    }

    static func == (left: FakeNode, right: FakeNode) -> Bool { left === right }
    func hash(into hasher: inout Hasher) { hasher.combine(ObjectIdentifier(self)) }
}

final class FakeAX: AXSource {
    var apps: [Int32: FakeNode] = [:]
    var valueRequests: [FakeNode] = []
    var performed: [(action: String, element: FakeNode)] = []
    var numbersSet: [(value: Double, element: FakeNode)] = []

    func application(pid: Int32) -> FakeNode {
        apps[pid] ?? FakeNode("AXApplication")
    }

    func text(_ attribute: TextAttribute, of element: FakeNode) -> String? {
        switch attribute {
        case .role: return element.role
        case .subrole: return element.subrole
        case .title: return element.title
        case .description: return element.description
        case .identifier: return element.identifier
        }
    }

    func valueText(of element: FakeNode) -> String? {
        valueRequests.append(element)
        return element.value
    }

    func flag(_ attribute: FlagAttribute, of element: FakeNode) -> Bool? {
        attribute == .enabled ? element.enabled : element.focused
    }

    func element(_ attribute: ElementAttribute, of element: FakeNode) -> FakeNode? {
        attribute == .parent ? element.parent : element.related[attribute]
    }

    func elements(_ attribute: ListAttribute, of element: FakeNode) -> [FakeNode] {
        attribute == .children ? element.children : element.windows
    }

    func actionNames(of element: FakeNode) -> [String] { element.actions }

    func isAlive(_ element: FakeNode) -> Bool { element.alive }

    func numberValue(of element: FakeNode) -> Double? { element.number }

    func perform(_ action: String, on element: FakeNode) throws {
        performed.append((action, element))
    }

    func setNumberValue(_ value: Double, of element: FakeNode) throws {
        numbersSet.append((value, element))
        element.number = value
    }
}

final class FakeSystem: SystemSource {
    var trusted = true
    var running: Set<Int32> = []
    var apps: [RunningApp] = []
    var postedKeys: [(key: KeyCode, pid: Int32)] = []
    var openedPid: Int32?

    func isTrusted() -> Bool { trusted }
    func promptForTrust() -> Bool { trusted }
    func status() -> SessionStatus {
        SessionStatus(trusted: trusted, locked: false, secureInput: false, idleSeconds: 3, frontmostPid: nil)
    }
    func runningApps() -> [RunningApp] { apps }
    func isRunning(pid: Int32) -> Bool { running.contains(pid) }
    func open(bundleId: String) -> Int32? { openedPid }
    func postKey(_ key: KeyCode, toPid pid: Int32) { postedKeys.append((key, pid)) }
}

struct Scene {
    static let pid: Int32 = 42

    let ax = FakeAX()
    let system = FakeSystem()
    let app = FakeNode("AXApplication", title: "Notes")
    let window = FakeNode("AXWindow", title: "Inbox")
    let engine: Engine<FakeSystem, FakeAX>

    init() {
        ax.apps[Self.pid] = app
        system.running = [Self.pid]
        app.add(window)
        app.windows = [window]
        app.related[.mainWindow] = window
        engine = Engine(system: system, source: ax)
    }

    func menuBar() -> FakeNode {
        let bar = app.add(FakeNode("AXMenuBar"))
        app.related[.menuBar] = bar
        return bar
    }

    @discardableResult
    func button(_ title: String, in parent: FakeNode? = nil) -> FakeNode {
        (parent ?? window).add(FakeNode("AXButton", title: title, actions: ["AXPress"]))
    }

    func read(window index: Int? = nil, ref: String? = nil, scope: RequestedScope? = nil) throws -> ReadResult {
        guard case .read(let result) = try engine.handle(.read(pid: Self.pid, window: index, ref: ref, scope: scope)) else {
            throw OpError(.invalid, "not a read")
        }
        return result
    }

    func target(_ ref: String, refind: Bool) throws -> Target {
        guard case .target(let result) = try engine.handle(.target(pid: Self.pid, ref: ref, refind: refind)) else {
            throw OpError(.invalid, "not a target")
        }
        return result
    }

    func ref(of node: FakeNode, in result: ReadResult) -> String? {
        result.nodes.first { $0.identity == ax.identity(of: node) }?.ref
    }

    func errorCode(_ request: Request) -> ErrorCode? {
        do {
            _ = try engine.handle(request)
            return nil
        } catch let error as OpError {
            return error.code
        } catch {
            return .axFailed
        }
    }
}
