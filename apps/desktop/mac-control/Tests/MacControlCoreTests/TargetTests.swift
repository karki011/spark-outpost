import Testing
@testable import MacControlCore

@Suite struct TargetTests {
    @Test func aliveTargetReportsContext() throws {
        let scene = Scene()
        let toolbar = scene.window.add(FakeNode("AXGroup", title: "Toolbar"))
        let send = scene.button("Send", in: toolbar)
        let ref = try #require(scene.ref(of: send, in: try scene.read()))
        let target = try scene.target(ref, refind: false)
        #expect(target.state == .alive)
        #expect(target.pid == Scene.pid)
        #expect(target.window == WindowInfo(index: 0, title: "Inbox"))
        #expect(target.ancestors == ["Toolbar", "Inbox", "Notes"])
        #expect(target.actions == ["AXPress"])
        #expect(!target.secure)
    }

    @Test func deadTargetWithoutRefindIsGoneWithStoredIdentity() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let ref = try #require(scene.ref(of: send, in: try scene.read()))
        send.kill()
        scene.button("Send")
        let target = try scene.target(ref, refind: false)
        #expect(target.state == .gone)
        #expect(target.identity.title == "Send")
        #expect(target.actions == [])
        #expect(target.window == WindowInfo(index: 0, title: "Inbox"))
    }

    @Test func refindRebindsToTheSingleMatch() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let ref = try #require(scene.ref(of: send, in: try scene.read()))
        send.kill()
        let replacement = scene.button("Send")
        let target = try scene.target(ref, refind: true)
        #expect(target.state == .refound)
        #expect(target.ref == ref)
        try scene.engine.press(ref: ref, expect: scene.ax.identity(of: replacement))
        #expect(scene.ax.performed.last?.element === replacement)
        #expect(try scene.target(ref, refind: false).state == .alive)
    }

    @Test func refindWithTwoMatchesIsGone() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let ref = try #require(scene.ref(of: send, in: try scene.read()))
        send.kill()
        scene.button("Send")
        scene.button("Send")
        #expect(try scene.target(ref, refind: true).state == .gone)
    }

    @Test func refindNeedsTheSameAncestors() throws {
        let scene = Scene()
        let toolbar = scene.window.add(FakeNode("AXGroup", title: "Toolbar"))
        let send = scene.button("Send", in: toolbar)
        let ref = try #require(scene.ref(of: send, in: try scene.read()))
        send.kill()
        scene.button("Send")
        #expect(try scene.target(ref, refind: true).state == .gone)
    }

    @Test func refindNeedsATitleOrIdentifier() throws {
        let scene = Scene()
        let untitled = scene.window.add(FakeNode("AXButton", actions: ["AXPress"]))
        let ref = try #require(try scene.read().nodes.last?.ref)
        untitled.kill()
        scene.window.add(FakeNode("AXButton", actions: ["AXPress"]))
        #expect(try scene.target(ref, refind: true).state == .gone)
    }

    @Test func closedWindowIsGoneWithNoWindow() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let ref = try #require(scene.ref(of: send, in: try scene.read()))
        scene.window.kill()
        let target = try scene.target(ref, refind: true)
        #expect(target.state == .gone)
        #expect(target.window == nil)
    }

    @Test func aliveElementInAClosedWindowIsGone() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let ref = try #require(scene.ref(of: send, in: try scene.read()))
        scene.app.windows = []
        #expect(try scene.target(ref, refind: false).state == .gone)
    }

    @Test func closedSheetIsGoneEvenWithAMatch() throws {
        let scene = Scene()
        let sheet = scene.window.add(FakeNode("AXSheet"))
        let save = scene.button("Save", in: sheet)
        let ref = try #require(scene.ref(of: save, in: try scene.read()))
        sheet.kill()
        let newSheet = scene.window.add(FakeNode("AXSheet"))
        scene.button("Save", in: newSheet)
        #expect(try scene.target(ref, refind: true).state == .gone)
    }

    @Test func refsDieWithTheirApp() throws {
        let scene = Scene()
        let bar = scene.menuBar()
        let file = bar.add(FakeNode("AXMenuBarItem", title: "File", actions: ["AXPress"]))
        let target = try scene.engine.menuItem(pid: Scene.pid, path: ["File"])
        scene.system.running = []
        #expect(try scene.target(target.ref, refind: true).state == .gone)
        #expect(scene.errorCode(.press(ref: target.ref, expect: scene.ax.identity(of: file))) == .gone)
    }

    @Test func unknownRefIsGoneError() {
        let scene = Scene()
        #expect(scene.errorCode(.target(ref: "ax_77", refind: true)) == .gone)
    }

    @Test func focusedElementGetsARef() throws {
        let scene = Scene()
        let field = scene.window.add(FakeNode("AXTextField", title: "Search"))
        scene.app.related[.focusedElement] = field
        guard case .focused(let target) = try scene.engine.handle(.focused(pid: Scene.pid)) else {
            throw OpError(.invalid, "focused")
        }
        #expect(target?.ref == "ax_1")
        #expect(target?.identity.title == "Search")
        #expect(target?.ancestors == ["Inbox", "Notes"])
        scene.app.related[.focusedElement] = nil
        #expect(try scene.engine.handle(.focused(pid: Scene.pid)) == .focused(nil))
    }

    @Test func menuWalkFindsTheItemWithoutPressing() throws {
        let scene = Scene()
        let bar = scene.menuBar()
        let file = bar.add(FakeNode("AXMenuBarItem", title: "File"))
        let menu = file.add(FakeNode("AXMenu"))
        let export = menu.add(FakeNode("AXMenuItem", title: "Export"))
        let exportMenu = export.add(FakeNode("AXMenu"))
        exportMenu.add(FakeNode("AXMenuItem", title: "PDF…", actions: ["AXPress"]))
        let target = try scene.engine.menuItem(pid: Scene.pid, path: [" file ", "EXPORT", "pdf…"])
        #expect(target.identity.title == "PDF…")
        #expect(target.ancestors == ["Export", "File", "Notes"])
        #expect(target.window == nil)
        #expect(scene.ax.performed.isEmpty)
    }

    @Test func menuWalkNamesTheMissingStep() throws {
        let scene = Scene()
        let bar = scene.menuBar()
        bar.add(FakeNode("AXMenuBarItem", title: "File")).add(FakeNode("AXMenu"))
        do {
            _ = try scene.engine.menuItem(pid: Scene.pid, path: ["File", "Print"])
            Issue.record("expected not_found")
        } catch let error as OpError {
            #expect(error.code == .notFound)
            #expect(error.message.contains("Print"))
        }
    }
}
