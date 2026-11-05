extension AXSource {
    func identity(of element: Element) -> Identity {
        Identity(
            role: text(.role, of: element) ?? AXName.unknownRole,
            subrole: text(.subrole, of: element),
            title: text(.title, of: element),
            description: text(.description, of: element),
            identifier: text(.identifier, of: element)
        )
    }

    func lineage(of element: Element) -> Placement<Element> {
        var lineage = Placement<Element>.top
        var current = self.element(.parent, of: element)
        var steps = 0
        while let ancestor = current, steps < 64 {
            let role = text(.role, of: ancestor)
            if role == AXName.window, lineage.window == nil { lineage.window = ancestor }
            if role == AXName.sheet, lineage.sheet == nil { lineage.sheet = ancestor }
            let title = clipNonEmpty(text(.title, of: ancestor), Limits.title)
            if lineage.ancestors.count < Limits.ancestors, let title {
                lineage.ancestors.append(title)
            }
            current = self.element(.parent, of: ancestor)
            steps += 1
        }
        return lineage
    }
}

struct Visit<Element: Hashable> {
    var element: Element
    var depth: Int
    var identity: Identity
    var placement: Placement<Element>
}

struct Walker<Source: AXSource> {
    let source: Source
    var nodeLimit = Limits.readNodes
    var depthLimit = Limits.readDepth

    func walk(
        from root: Source.Element,
        lineage: Placement<Source.Element>,
        visit: (Visit<Source.Element>) -> Bool
    ) -> Bool {
        var visited = 0
        var stack = [(element: root, depth: 0, lineage: lineage)]
        var truncated = false
        while let next = stack.popLast() {
            if visited == nodeLimit {
                return true
            }
            let identity = source.identity(of: next.element)
            let placement = next.lineage.placing(next.element, role: identity.role)
            let keepGoing = visit(Visit(element: next.element, depth: next.depth, identity: identity, placement: placement))
            visited += 1
            if !keepGoing { return truncated }
            let children = source.elements(.children, of: next.element)
            if children.isEmpty { continue }
            if next.depth == depthLimit {
                truncated = true
                continue
            }
            let childLineage = placement.lineageForChildren(title: identity.title)
            for child in children.reversed() {
                stack.append((element: child, depth: next.depth + 1, lineage: childLineage))
            }
        }
        return truncated
    }
}
