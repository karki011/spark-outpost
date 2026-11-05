import Testing
@testable import MacControlCore

@Suite struct ReadTests {
    @Test func refsAreStableAcrossReads() throws {
        let scene = Scene()
        scene.button("Send")
        scene.button("Cancel")
        let first = try scene.read()
        let second = try scene.read()
        #expect(first.nodes.map(\.ref) == ["ax_1", "ax_2", "ax_3"])
        #expect(second.nodes.map(\.ref) == first.nodes.map(\.ref))
        #expect(first.rootRef == "ax_1")
        #expect(first.scope == .window)
        #expect(first.window == WindowInfo(index: 0, title: "Inbox"))
    }

    @Test func refsAreNeverReusedAfterAnElementDies() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let first = try scene.read()
        let sendRef = try #require(scene.ref(of: send, in: first))
        send.kill()
        let replacement = scene.button("Send")
        let second = try scene.read()
        let replacementRef = try #require(scene.ref(of: replacement, in: second))
        #expect(replacementRef != sendRef)
        #expect(replacementRef == "ax_3")
        let numbers = (first.nodes + second.nodes).compactMap { Int($0.ref.dropFirst(3)) }
        #expect(Set(numbers) == [1, 2, 3])
    }

    @Test func secureFieldValueIsNeverRead() throws {
        let scene = Scene()
        let password = scene.window.add(FakeNode("AXTextField", title: "Password", subrole: "AXSecureTextField"))
        password.value = "hunter2"
        let name = scene.window.add(FakeNode("AXTextField", title: "Name"))
        name.value = "Ada"
        let result = try scene.read()
        let secureNode = try #require(result.nodes.first { $0.identity.title == "Password" })
        #expect(secureNode.secure)
        #expect(secureNode.value == nil)
        #expect(!scene.ax.valueRequests.contains(password))
        #expect(result.nodes.first { $0.identity.title == "Name" }?.value == "Ada")
    }

    @Test func secureRoleIsMaskedToo() throws {
        let scene = Scene()
        let field = scene.window.add(FakeNode("AXSecureTextField"))
        field.value = "secret"
        let result = try scene.read()
        #expect(result.nodes.last?.secure == true)
        #expect(!scene.ax.valueRequests.contains(field))
    }

    @Test func defaultReadCoversTheSheet() throws {
        let scene = Scene()
        scene.button("Behind")
        let sheet = scene.window.add(FakeNode("AXSheet"))
        scene.button("Save", in: sheet)
        let result = try scene.read()
        #expect(result.scope == .sheet)
        #expect(result.nodes.map(\.identity.role) == ["AXSheet", "AXButton"])
        #expect(result.window == WindowInfo(index: 0, title: "Inbox"))
        #expect(result.nodes[1].depth == 1)
    }

    @Test func explicitWindowScopeReadsTheWholeWindow() throws {
        let scene = Scene()
        scene.button("Behind")
        let sheet = scene.window.add(FakeNode("AXSheet"))
        scene.button("Save", in: sheet)
        let result = try scene.read(scope: .window)
        #expect(result.scope == .window)
        #expect(result.nodes.count == 4)
    }

    @Test func dialogWindowReportsSheetScope() throws {
        let scene = Scene()
        scene.window.subrole = "AXDialog"
        scene.button("OK")
        let result = try scene.read()
        #expect(result.scope == .sheet)
        #expect(result.nodes.count == 2)
    }

    @Test func readByRefCoversThatSubtree() throws {
        let scene = Scene()
        let group = scene.window.add(FakeNode("AXGroup", title: "Toolbar"))
        scene.button("Bold", in: group)
        let groupRef = try #require(scene.ref(of: group, in: try scene.read()))
        let result = try scene.read(ref: groupRef)
        #expect(result.scope == .ref)
        #expect(result.rootRef == groupRef)
        #expect(result.nodes.map(\.depth) == [0, 1])
    }

    @Test func readByDeadRefIsGone() throws {
        let scene = Scene()
        let group = scene.window.add(FakeNode("AXGroup", title: "Toolbar"))
        let groupRef = try #require(scene.ref(of: group, in: try scene.read()))
        group.kill()
        #expect(scene.errorCode(.read(pid: Scene.pid, window: nil, ref: groupRef, scope: nil)) == .gone)
    }

    @Test func menuScopeReadsTheMenuBar() throws {
        let scene = Scene()
        let bar = scene.menuBar()
        bar.add(FakeNode("AXMenuBarItem", title: "File"))
        let result = try scene.read(scope: .menu)
        #expect(result.scope == .menu)
        #expect(result.nodes.map(\.identity.role) == ["AXMenuBar", "AXMenuBarItem"])
        #expect(result.window == WindowInfo(index: 0, title: "Inbox"))
    }

    @Test func missingWindowIsNoWindow() throws {
        let scene = Scene()
        #expect(scene.errorCode(.read(pid: Scene.pid, window: 3, ref: nil, scope: nil)) == .noWindow)
        scene.app.windows = []
        scene.app.related = [:]
        #expect(scene.errorCode(.read(pid: Scene.pid, window: nil, ref: nil, scope: nil)) == .noWindow)
    }

    @Test func nodeCapTruncatesAtExactlyTheLimit() throws {
        let full = Scene()
        for index in 1..<Limits.readNodes { full.button("B\(index)") }
        let fitting = try full.read()
        #expect(fitting.nodes.count == Limits.readNodes)
        #expect(!fitting.truncated)
        full.button("One more")
        let over = try full.read()
        #expect(over.nodes.count == Limits.readNodes)
        #expect(over.truncated)
    }

    @Test func depthCapIncludesDepthThirtyAndTruncatesBelowIt() throws {
        let scene = Scene()
        var deepest = scene.window
        for level in 1...Limits.readDepth {
            deepest = deepest.add(FakeNode("AXGroup", title: "L\(level)"))
        }
        let atLimit = try scene.read()
        #expect(atLimit.nodes.last?.depth == Limits.readDepth)
        #expect(!atLimit.truncated)
        deepest.add(FakeNode("AXStaticText", title: "too deep"))
        let below = try scene.read()
        #expect(below.truncated)
        #expect(below.nodes.count == atLimit.nodes.count)
    }

    @Test func longStringsAreClipped() throws {
        let scene = Scene()
        let field = scene.window.add(FakeNode("AXTextField", title: String(repeating: "t", count: 500)))
        field.value = String(repeating: "v", count: 900)
        let node = try #require(try scene.read().nodes.last)
        #expect(node.identity.title?.count == Limits.title)
        #expect(node.value?.count == Limits.value)
    }

    @Test func clipKeepsSurrogatePairsWhole() {
        #expect(clip("ab😀", 3) == "ab")
        #expect(clip("ab😀", 4) == "ab😀")
    }

    @Test func untrustedAndUnknownAppsAreRefused() {
        let scene = Scene()
        scene.system.trusted = false
        #expect(scene.errorCode(.read(pid: 999, window: nil, ref: nil, scope: nil)) == .notTrusted)
        scene.system.trusted = true
        #expect(scene.errorCode(.read(pid: 999, window: nil, ref: nil, scope: nil)) == .noApp)
    }

    @Test func appsListWindowsOnlyWhenTrusted() throws {
        let scene = Scene()
        let signature = Signature(valid: true, apple: true, teamId: nil)
        scene.system.apps = [RunningApp(pid: Scene.pid, name: nil, bundleId: "com.apple.Notes", path: nil, frontmost: true, signature: signature)]
        guard case .apps(let trustedApps) = try scene.engine.handle(.apps) else { throw OpError(.invalid, "apps") }
        #expect(trustedApps.first?.windows == [WindowInfo(index: 0, title: "Inbox")])
        #expect(trustedApps.first?.app.name == "com.apple.Notes")
        scene.system.trusted = false
        guard case .apps(let untrustedApps) = try scene.engine.handle(.apps) else { throw OpError(.invalid, "apps") }
        #expect(untrustedApps.first?.windows == [])
    }
}
