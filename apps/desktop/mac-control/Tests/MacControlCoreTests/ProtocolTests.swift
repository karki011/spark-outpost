import Foundation
import Testing
@testable import MacControlCore

@Suite struct ProtocolTests {
    private func object(_ line: String) throws -> [String: Any] {
        let parsed = try JSONSerialization.jsonObject(with: Data(line.utf8))
        return try #require(parsed as? [String: Any])
    }

    private func respond(_ scene: Scene, _ line: String) throws -> [String: Any]? {
        guard let response = responseLine(for: line, engine: scene.engine) else { return nil }
        #expect(!response.contains("\n"))
        return try object(response)
    }

    @Test func focusedWithNothingEncodesANullResult() {
        let line = successLine(id: "7", result: .focused(nil))
        #expect(line.contains(#""result":null"#))
        #expect(line.contains(#""ok":true"#))
        #expect(line.contains(#""id":"7""#))
    }

    @Test func absentOptionalsAreNullNotMissing() throws {
        let identity = Identity(role: "AXButton", subrole: nil, title: "", description: nil, identifier: nil)
        let target = Target(ref: "ax_1", state: .gone, pid: 3, window: nil, identity: identity, ancestors: [], actions: [], secure: false)
        let encoded = try object(successLine(id: "1", result: .target(target)))
        let result = try #require(encoded["result"] as? [String: Any])
        #expect(result["window"] is NSNull)
        let encodedIdentity = try #require(result["identity"] as? [String: Any])
        for key in ["subrole", "title", "description", "identifier"] {
            #expect(encodedIdentity[key] is NSNull)
        }
    }

    @Test func nodesFlattenIdentityWithNullValue() throws {
        let identity = Identity(role: "AXButton", subrole: nil, title: "Send", description: nil, identifier: nil)
        let node = Node(ref: "ax_2", depth: 1, identity: identity, value: nil, enabled: true, focused: false, secure: false, actions: ["AXPress"])
        let read = ReadResult(window: WindowInfo(index: 0, title: nil), scope: .window, rootRef: "ax_2", nodes: [node], truncated: false)
        let result = try #require(try object(successLine(id: "1", result: .read(read)))["result"] as? [String: Any])
        let nodes = try #require(result["nodes"] as? [[String: Any]])
        #expect(nodes[0]["role"] as? String == "AXButton")
        #expect(nodes[0]["title"] as? String == "Send")
        #expect(nodes[0]["value"] is NSNull)
        #expect(nodes[0]["subrole"] is NSNull)
        #expect((result["window"] as? [String: Any])?["title"] is NSNull)
    }

    @Test func statusAndAppsEncodeNullables() throws {
        let scene = Scene()
        let status = try object(try #require(responseLine(for: #"{"id":"s","op":"status"}"#, engine: scene.engine)))
        #expect((status["result"] as? [String: Any])?["frontmostPid"] is NSNull)
        scene.system.apps = [RunningApp(pid: 5, name: "X", bundleId: nil, path: nil, frontmost: false, signature: Signature(valid: false, apple: false, teamId: nil))]
        let apps = try object(try #require(responseLine(for: #"{"id":"a","op":"apps"}"#, engine: scene.engine)))
        let app = try #require(((apps["result"] as? [String: Any])?["apps"] as? [[String: Any]])?.first)
        #expect(app["bundleId"] is NSNull)
        #expect(app["path"] is NSNull)
        #expect((app["signature"] as? [String: Any])?["teamId"] is NSNull)
    }

    @Test func errorsCarryCodeAndMessage() throws {
        let scene = Scene()
        scene.system.trusted = false
        let response = try #require(try respond(scene, #"{"id":"3","op":"read","pid":1}"#))
        #expect(response["ok"] as? Bool == false)
        #expect(response["code"] as? String == "not_trusted")
        #expect(response["id"] as? String == "3")
    }

    @Test func linesWithoutAStringIdAreIgnored() throws {
        let scene = Scene()
        #expect(try respond(scene, "not json") == nil)
        #expect(try respond(scene, #"{"op":"status"}"#) == nil)
        #expect(try respond(scene, #"{"id":4,"op":"status"}"#) == nil)
    }

    @Test func malformedRequestsWithAnIdAreInvalid() throws {
        let scene = Scene()
        let lines = [
            #"{"id":"a","op":"bogus"}"#,
            #"{"id":"b"}"#,
            #"{"id":"c","op":"read"}"#,
            #"{"id":"d","op":"read","pid":0}"#,
            #"{"id":"e","op":"read","pid":"7"}"#,
            #"{"id":"f","op":"target","ref":"ax_0","refind":true}"#,
            #"{"id":"g","op":"target","ref":"ax_1"}"#,
            #"{"id":"h","op":"key","ref":"ax_1","key":"tab","expect":{"role":"AXButton","subrole":null,"title":null,"description":null,"identifier":null}}"#,
            #"{"id":"i","op":"menu","pid":3,"path":[]}"#,
            #"{"id":"j","op":"scroll","pid":3,"direction":"sideways"}"#,
            #"{"id":"k","op":"open","bundleId":""}"#,
        ]
        for line in lines {
            let response = try #require(try respond(scene, line))
            #expect(response["code"] as? String == "invalid", "\(line)")
        }
    }

    @Test func validRequestsParse() {
        let press = #"{"id":"p","op":"press","ref":"ax_12","expect":{"role":"AXButton","subrole":null,"title":"Send","description":null,"identifier":null}}"#
        let expected = Identity(role: "AXButton", subrole: nil, title: "Send", description: nil, identifier: nil)
        #expect(parseRequestLine(press) == .request(id: "p", .press(ref: "ax_12", expect: expected)))
        let key = #"{"id":"k","op":"key","ref":"ax_1","key":"return","expect":{"role":"AXButton","subrole":null,"title":null,"description":null,"identifier":null}}"#
        #expect(parseRequestLine(key) == .request(id: "k", .key(ref: "ax_1", key: .returnKey, expect: Identity(role: "AXButton", subrole: nil, title: nil, description: nil, identifier: nil))))
        #expect(parseRequestLine(#"{"id":"r","op":"read","pid":9,"window":1,"scope":"sheet"}"#) == .request(id: "r", .read(pid: 9, window: 1, ref: nil, scope: .sheet)))
    }

    @Test func refsFollowTheContractPattern() {
        #expect(isValidRef("ax_1"))
        #expect(isValidRef("ax_999999999"))
        #expect(!isValidRef("ax_0"))
        #expect(!isValidRef("ax_01"))
        #expect(!isValidRef("ax_1000000000"))
        #expect(!isValidRef("ax_"))
        #expect(!isValidRef("bx_1"))
    }

    @Test func statusClampsIdleSeconds() {
        #expect(SessionStatus(trusted: true, locked: false, secureInput: false, idleSeconds: .nan, frontmostPid: 0).idleSeconds == 0)
        #expect(SessionStatus(trusted: true, locked: false, secureInput: false, idleSeconds: -4, frontmostPid: 0).frontmostPid == nil)
    }
}
