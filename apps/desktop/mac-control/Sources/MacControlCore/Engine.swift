import Foundation

public final class Engine<System: SystemSource, Source: AXSource> {
    typealias Element = Source.Element

    let system: System
    let source: Source
    let refs = RefStore<Source.Element>()
    var walker: Walker<Source>

    public init(system: System, source: Source) {
        self.system = system
        self.source = source
        self.walker = Walker(source: source)
    }

    public func handle(_ request: Request) throws -> OpResult {
        switch request {
        case .status:
            return .status(system.status())
        case .prompt:
            return .trusted(system.promptForTrust())
        case .apps:
            return .apps(listApps())
        case .open(let bundleId):
            return .pid(try open(bundleId: bundleId))
        default:
            guard system.isTrusted() else {
                throw OpError(.notTrusted, "Accessibility access is not granted")
            }
            return try handleTrusted(request)
        }
    }

    private func handleTrusted(_ request: Request) throws -> OpResult {
        switch request {
        case .read(let pid, let window, let ref, let scope):
            return .read(try read(pid: pid, windowIndex: window, ref: ref, scope: scope))
        case .target(let pid, let ref, let refind):
            return .target(try target(pid: pid, ref: ref, refind: refind))
        case .focused(let pid):
            return .focused(try focused(pid: pid))
        case .menu(let pid, let path):
            return .target(try menuItem(pid: pid, path: path))
        case .press(let pid, let ref, let expect):
            try press(pid: pid, ref: ref, expect: expect)
            return .done
        case .key(let pid, let ref, let key, let expect):
            try pressKey(pid: pid, ref: ref, key: key, expect: expect)
            return .done
        case .scroll(let pid, let ref, let direction):
            try scroll(pid: pid, ref: ref, direction: direction)
            return .done
        case .status, .prompt, .apps, .open:
            throw OpError(.invalid, "unexpected op")
        }
    }

    private func listApps() -> [AppEntry] {
        let trusted = system.isTrusted()
        return system.runningApps()
            .filter { $0.pid > 0 }
            .prefix(Limits.apps)
            .map { app in
                AppEntry(app: app, windows: trusted ? windowList(pid: app.pid) : [])
            }
    }

    private func windowList(pid: Int32) -> [WindowInfo] {
        let windows = source.elements(.windows, of: source.application(pid: pid))
        return windows.prefix(Limits.windows).enumerated().map { index, window in
            WindowInfo(index: index, title: source.text(.title, of: window))
        }
    }

    private func open(bundleId: String) throws -> Int32 {
        guard let pid = system.open(bundleId: bundleId), pid > 0 else {
            throw OpError(.notFound, "no app with bundle id \(bundleId)")
        }
        return pid
    }

    func requireApp(_ pid: Int32) throws -> Element {
        guard system.isRunning(pid: pid) else {
            throw OpError(.noApp, "no running app with pid \(pid)")
        }
        return source.application(pid: pid)
    }

    func windows(pid: Int32) -> [Element] {
        source.elements(.windows, of: source.application(pid: pid))
    }

    func defaultWindow(of app: Element, among windows: [Element]) -> Element? {
        source.element(.mainWindow, of: app) ?? source.element(.focusedWindow, of: app) ?? windows.first
    }

    func windowInfo(_ window: Element, among windows: [Element]) -> WindowInfo {
        WindowInfo(index: windows.firstIndex(of: window) ?? 0, title: source.text(.title, of: window))
    }

    func mainWindowInfo(pid: Int32) -> WindowInfo {
        let app = source.application(pid: pid)
        let windows = windows(pid: pid)
        guard let window = defaultWindow(of: app, among: windows) else {
            return WindowInfo(index: 0, title: nil)
        }
        return windowInfo(window, among: windows)
    }

    func isOpen(_ window: Element?, pid: Int32) -> Bool {
        guard system.isRunning(pid: pid) else { return false }
        guard let window else { return true }
        return source.isAlive(window) && windows(pid: pid).contains(window)
    }

    func storedRecord(_ ref: String) throws -> RefRecord<Element> {
        guard let record = refs.record(ref) else {
            throw OpError(.gone, "\(ref) is not known")
        }
        return record
    }

    func ownedRecord(_ ref: String, pid: Int32) throws -> RefRecord<Element> {
        let record = try storedRecord(ref)
        guard record.pid == pid else {
            throw OpError(.invalid, "\(ref) belongs to another app")
        }
        return record
    }

    func liveRecord(_ ref: String) throws -> RefRecord<Element> {
        let record = try storedRecord(ref)
        guard source.isAlive(record.element), isOpen(record.placement.window, pid: record.pid) else {
            throw OpError(.gone, "\(ref) is gone")
        }
        return record
    }

    func remember(_ element: Element, pid: Int32) -> (ref: String, record: RefRecord<Element>) {
        let identity = source.identity(of: element)
        let placement = source.lineage(of: element).placing(element, role: identity.role)
        let record = RefRecord(element: element, pid: pid, identity: identity, placement: placement)
        return (refs.ref(for: record), record)
    }

    func liveTarget(ref: String, record: RefRecord<Element>, state: TargetState) -> Target {
        Target(
            ref: ref,
            state: state,
            pid: record.pid,
            window: record.placement.window.map { windowInfo($0, among: windows(pid: record.pid)) },
            identity: record.identity,
            ancestors: record.placement.ancestors,
            actions: clippedActions(source.actionNames(of: record.element)),
            secure: record.identity.isSecure
        )
    }
}
