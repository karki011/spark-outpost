extension Engine {
    func read(pid: Int32, windowIndex: Int?, ref: String?, scope: RequestedScope?) throws -> ReadResult {
        let app = try requireApp(pid)
        if let ref {
            return try readRef(ref, pid: pid)
        }
        if scope == .menu {
            return try readMenu(app: app, pid: pid)
        }
        let windows = windows(pid: pid)
        let window = try pickWindow(app: app, windows: windows, index: windowIndex)
        let (root, readScope) = readRoot(window: window, scope: scope)
        return readTree(root: root, pid: pid, window: windowInfo(window, among: windows), scope: readScope)
    }

    private func readRef(_ ref: String, pid: Int32) throws -> ReadResult {
        let record = try liveRecord(ref)
        guard record.pid == pid else {
            throw OpError(.invalid, "\(ref) belongs to another app")
        }
        let window = record.placement.window.map { windowInfo($0, among: windows(pid: pid)) }
        return readTree(root: record.element, pid: pid, window: window ?? mainWindowInfo(pid: pid), scope: .ref)
    }

    private func readMenu(app: Element, pid: Int32) throws -> ReadResult {
        guard let menuBar = source.element(.menuBar, of: app) else {
            throw OpError(.notFound, "the app has no menu bar")
        }
        return readTree(root: menuBar, pid: pid, window: mainWindowInfo(pid: pid), scope: .menu)
    }

    private func pickWindow(app: Element, windows: [Element], index: Int?) throws -> Element {
        if let index {
            guard index < windows.count else {
                throw OpError(.noWindow, "no window \(index)")
            }
            return windows[index]
        }
        guard let window = defaultWindow(of: app, among: windows) else {
            throw OpError(.noWindow, "the app has no window")
        }
        return window
    }

    private func readRoot(window: Element, scope: RequestedScope?) -> (Element, ReadScope) {
        if scope == .window {
            return (window, .window)
        }
        let subrole = source.text(.subrole, of: window)
        if subrole == AXName.dialog || subrole == AXName.systemDialog {
            return (window, .sheet)
        }
        let sheets = source.elements(.children, of: window).filter { source.text(.role, of: $0) == AXName.sheet }
        if let frontmost = sheets.last {
            return (frontmost, .sheet)
        }
        return (window, .window)
    }

    private func readTree(root: Element, pid: Int32, window: WindowInfo, scope: ReadScope) -> ReadResult {
        var nodes: [Node] = []
        let truncated = walker.walk(from: root, lineage: source.lineage(of: root)) { visit in
            let record = RefRecord(element: visit.element, pid: pid, identity: visit.identity, placement: visit.placement)
            nodes.append(node(for: visit, ref: refs.ref(for: record)))
            return true
        }
        return ReadResult(window: window, scope: scope, rootRef: nodes[0].ref, nodes: nodes, truncated: truncated)
    }

    private func node(for visit: Visit<Element>, ref: String) -> Node {
        let secure = visit.identity.isSecure
        let value = secure ? nil : source.valueText(of: visit.element).map { clip($0, Limits.value) }
        return Node(
            ref: ref,
            depth: visit.depth,
            identity: visit.identity,
            value: value,
            enabled: source.flag(.enabled, of: visit.element) ?? true,
            focused: source.flag(.focused, of: visit.element) ?? false,
            secure: secure,
            actions: clippedActions(source.actionNames(of: visit.element))
        )
    }
}
