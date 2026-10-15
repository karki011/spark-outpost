extension Engine {
    func press(ref: String, expect: Identity) throws {
        let record = try checkedRecord(ref, expect: expect)
        let actions = source.actionNames(of: record.element)
        let pressActions = [AXName.press, AXName.confirm, AXName.pick]
        guard let action = pressActions.first(where: actions.contains) else {
            throw OpError(.notPressable, "\(ref) offers no press action")
        }
        try source.perform(action, on: record.element)
    }

    func pressKey(ref: String, key: HelperKey, expect: Identity) throws {
        let record = try checkedRecord(ref, expect: expect)
        let pressable = source.actionNames(of: record.element).contains(AXName.press)
        switch key {
        case .space:
            guard pressable else {
                throw OpError(.notPressable, "\(ref) offers no press action")
            }
            try source.perform(AXName.press, on: record.element)
        case .returnKey:
            if pressable {
                try source.perform(AXName.press, on: record.element)
            } else {
                system.postKey(.returnKey, toPid: record.pid)
            }
        case .enter:
            system.postKey(.enterKey, toPid: record.pid)
        }
    }

    func scroll(pid: Int32, ref: String?, direction: ScrollDirection) throws {
        let app = try requireApp(pid)
        var area: Element?
        if let ref {
            let record = try liveRecord(ref)
            guard record.pid == pid else {
                throw OpError(.invalid, "\(ref) belongs to another app")
            }
            area = enclosingScrollArea(of: record.element)
        }
        if area == nil {
            area = firstScrollArea(app: app, pid: pid)
        }
        guard let area else {
            throw OpError(.notFound, "no scroll area")
        }
        try move(area: area, direction: direction)
    }

    private func checkedRecord(_ ref: String, expect: Identity) throws -> RefRecord<Element> {
        let record = try liveRecord(ref)
        guard source.identity(of: record.element) == expect else {
            throw OpError(.changed, "\(ref) no longer matches the expected element")
        }
        return record
    }

    private func enclosingScrollArea(of element: Element) -> Element? {
        var current: Element? = element
        var steps = 0
        while let candidate = current, steps < 64 {
            if source.text(.role, of: candidate) == AXName.scrollArea { return candidate }
            current = source.element(.parent, of: candidate)
            steps += 1
        }
        return nil
    }

    private func firstScrollArea(app: Element, pid: Int32) -> Element? {
        guard let window = defaultWindow(of: app, among: windows(pid: pid)) else { return nil }
        var found: Element?
        _ = walker.walk(from: window, lineage: .top) { visit in
            if visit.identity.role == AXName.scrollArea {
                found = visit.element
                return false
            }
            return true
        }
        return found
    }

    private func move(area: Element, direction: ScrollDirection) throws {
        let vertical = direction == .up || direction == .down
        guard let bar = source.element(vertical ? .verticalScrollBar : .horizontalScrollBar, of: area) else {
            throw OpError(.notFound, vertical ? "no vertical scroll bar" : "no horizontal scroll bar")
        }
        guard let current = source.numberValue(of: bar) else {
            throw OpError(.axFailed, "the scroll bar has no value")
        }
        let step = (direction == .down || direction == .right) ? 0.2 : -0.2
        try source.setNumberValue(min(1, max(0, current + step)), of: bar)
    }
}
