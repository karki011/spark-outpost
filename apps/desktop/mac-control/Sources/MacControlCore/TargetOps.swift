import Foundation

extension Engine {
    func target(ref: String, refind: Bool) throws -> Target {
        let stored = try storedRecord(ref)
        let windowOpen = isOpen(stored.placement.window, pid: stored.pid)
        if windowOpen, source.isAlive(stored.element) {
            var current = stored
            current.identity = source.identity(of: stored.element)
            refs.rebind(ref, to: current)
            return liveTarget(ref: ref, record: current, state: .alive)
        }
        guard refind, windowOpen, !sheetClosed(stored), let match = refindMatch(for: stored) else {
            return goneTarget(ref: ref, record: stored, windowOpen: windowOpen)
        }
        refs.rebind(ref, to: match)
        return liveTarget(ref: ref, record: match, state: .refound)
    }

    func focused(pid: Int32) throws -> Target? {
        let app = try requireApp(pid)
        guard let element = source.element(.focusedElement, of: app) else { return nil }
        let remembered = remember(element, pid: pid)
        return liveTarget(ref: remembered.ref, record: remembered.record, state: .alive)
    }

    func menuItem(pid: Int32, path: [String]) throws -> Target {
        let app = try requireApp(pid)
        guard var current = source.element(.menuBar, of: app) else {
            throw OpError(.notFound, "the app has no menu bar")
        }
        for step in path {
            let items = menuItems(of: current)
            guard let match = items.first(where: { titlesMatch(source.text(.title, of: $0), step) }) else {
                throw OpError(.notFound, "no menu item \"\(clip(step, 200))\"")
            }
            current = match
        }
        let remembered = remember(current, pid: pid)
        return liveTarget(ref: remembered.ref, record: remembered.record, state: .alive)
    }

    private func sheetClosed(_ record: RefRecord<Element>) -> Bool {
        guard let sheet = record.placement.sheet else { return false }
        return !source.isAlive(sheet)
    }

    private func goneTarget(ref: String, record: RefRecord<Element>, windowOpen: Bool) -> Target {
        let window = windowOpen ? record.placement.window.map { windowInfo($0, among: windows(pid: record.pid)) } : nil
        return Target(
            ref: ref,
            state: .gone,
            pid: record.pid,
            window: window,
            identity: record.identity,
            ancestors: record.placement.ancestors,
            actions: [],
            secure: record.identity.isSecure
        )
    }

    private func refindMatch(for record: RefRecord<Element>) -> RefRecord<Element>? {
        let wanted = record.identity
        guard let window = record.placement.window, wanted.title != nil || wanted.identifier != nil else {
            return nil
        }
        var matches: [RefRecord<Element>] = []
        _ = walker.walk(from: window, lineage: source.lineage(of: window)) { visit in
            let candidate = visit.identity
            let same = candidate.role == wanted.role
                && (wanted.title == nil || candidate.title == wanted.title)
                && (wanted.identifier == nil || candidate.identifier == wanted.identifier)
                && visit.placement.ancestors == record.placement.ancestors
            if same {
                matches.append(RefRecord(element: visit.element, pid: record.pid, identity: candidate, placement: visit.placement))
            }
            return matches.count < 2
        }
        return matches.count == 1 ? matches[0] : nil
    }

    private func menuItems(of element: Element) -> [Element] {
        let role = source.text(.role, of: element)
        if role == AXName.menuBar || role == AXName.menu {
            return source.elements(.children, of: element)
        }
        let menus = source.elements(.children, of: element).filter { source.text(.role, of: $0) == AXName.menu }
        guard let menu = menus.first else { return [] }
        return source.elements(.children, of: menu)
    }

    private func titlesMatch(_ title: String?, _ step: String) -> Bool {
        guard let title else { return false }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedStep = step.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedTitle.caseInsensitiveCompare(trimmedStep) == .orderedSame
    }
}
