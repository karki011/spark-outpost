import Testing
@testable import MacControlCore

@Suite struct ActTests {
    private func readRef(_ scene: Scene, _ node: FakeNode) throws -> String {
        try #require(scene.ref(of: node, in: try scene.read()))
    }

    @Test func pressPerformsAXPress() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let ref = try readRef(scene, send)
        #expect(try scene.engine.handle(.press(ref: ref, expect: scene.ax.identity(of: send))) == .done)
        #expect(scene.ax.performed.map(\.action) == ["AXPress"])
    }

    @Test func pressWithALongTitleMatchesItsClippedIdentity() throws {
        let scene = Scene()
        let long = scene.button(String(repeating: "x", count: 400))
        let read = try scene.read()
        let node = try #require(read.nodes.last)
        try scene.engine.press(ref: node.ref, expect: node.identity)
        #expect(scene.ax.performed.last?.element === long)
    }

    @Test func pressFallsBackToConfirmThenPick() throws {
        let scene = Scene()
        let item = scene.window.add(FakeNode("AXCell", title: "Row", actions: ["AXPick", "AXConfirm"]))
        let ref = try readRef(scene, item)
        try scene.engine.press(ref: ref, expect: scene.ax.identity(of: item))
        #expect(scene.ax.performed.map(\.action) == ["AXConfirm"])
    }

    @Test func pressWithChangedIdentityIsRefused() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let ref = try readRef(scene, send)
        let expect = scene.ax.identity(of: send)
        send.title = "Delete"
        #expect(scene.errorCode(.press(ref: ref, expect: expect)) == .changed)
        #expect(scene.ax.performed.isEmpty)
    }

    @Test func pressOnADeadRefIsGoneWithoutRefind() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let ref = try readRef(scene, send)
        let expect = scene.ax.identity(of: send)
        send.kill()
        scene.button("Send")
        #expect(scene.errorCode(.press(ref: ref, expect: expect)) == .gone)
        #expect(scene.ax.performed.isEmpty)
    }

    @Test func pressWithoutAPressActionIsNotPressable() throws {
        let scene = Scene()
        let label = scene.window.add(FakeNode("AXStaticText", title: "Hello"))
        let ref = try readRef(scene, label)
        #expect(scene.errorCode(.press(ref: ref, expect: scene.ax.identity(of: label))) == .notPressable)
    }

    @Test func spaceOnAPressableElementPresses() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let ref = try readRef(scene, send)
        try scene.engine.pressKey(ref: ref, key: .space, expect: scene.ax.identity(of: send))
        #expect(scene.ax.performed.map(\.action) == ["AXPress"])
        #expect(scene.system.postedKeys.isEmpty)
    }

    @Test func spaceOnANonPressableElementIsRefused() throws {
        let scene = Scene()
        let field = scene.window.add(FakeNode("AXTextField", title: "To"))
        let ref = try readRef(scene, field)
        #expect(scene.errorCode(.key(ref: ref, key: .space, expect: scene.ax.identity(of: field))) == .notPressable)
    }

    @Test func returnAndEnterPostKeysToTheApp() throws {
        let scene = Scene()
        let field = scene.window.add(FakeNode("AXTextField", title: "To"))
        let ref = try readRef(scene, field)
        let expect = scene.ax.identity(of: field)
        try scene.engine.pressKey(ref: ref, key: .returnKey, expect: expect)
        try scene.engine.pressKey(ref: ref, key: .enter, expect: expect)
        #expect(scene.system.postedKeys.map(\.key) == [.returnKey, .enterKey])
        #expect(scene.system.postedKeys.allSatisfy { $0.pid == Scene.pid })
        #expect(KeyCode.returnKey.rawValue == 36 && KeyCode.enterKey.rawValue == 76)
    }

    @Test func keyWithChangedIdentityIsRefused() throws {
        let scene = Scene()
        let send = scene.button("Send")
        let ref = try readRef(scene, send)
        let expect = scene.ax.identity(of: send)
        send.identifier = "delete-button"
        #expect(scene.errorCode(.key(ref: ref, key: .returnKey, expect: expect)) == .changed)
        #expect(scene.system.postedKeys.isEmpty)
    }

    @Test func scrollMovesTheEnclosingScrollBar() throws {
        let scene = Scene()
        let area = scene.window.add(FakeNode("AXScrollArea"))
        let bar = FakeNode("AXScrollBar")
        bar.number = 0.9
        area.related[.verticalScrollBar] = bar
        let row = area.add(FakeNode("AXStaticText", title: "Row"))
        let ref = try readRef(scene, row)
        try scene.engine.scroll(pid: Scene.pid, ref: ref, direction: .down)
        #expect(bar.number == 1)
        try scene.engine.scroll(pid: Scene.pid, ref: nil, direction: .up)
        #expect(abs((bar.number ?? 0) - 0.8) < 0.0001)
    }

    @Test func scrollWithoutAScrollAreaIsNotFound() {
        let scene = Scene()
        #expect(scene.errorCode(.scroll(pid: Scene.pid, ref: nil, direction: .down)) == .notFound)
        scene.window.add(FakeNode("AXScrollArea"))
        #expect(scene.errorCode(.scroll(pid: Scene.pid, ref: nil, direction: .left)) == .notFound)
    }

    @Test func openReturnsThePidOrNotFound() throws {
        let scene = Scene()
        scene.system.trusted = false
        #expect(scene.errorCode(.open(bundleId: "com.apple.Notes")) == .notFound)
        scene.system.openedPid = 77
        #expect(try scene.engine.handle(.open(bundleId: "com.apple.Notes")) == .pid(77))
    }
}
