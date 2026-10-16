import Foundation
import Testing
@testable import VoiceCore

@Suite struct FnTwiceTests {
    @Test func twoPressesWithinTheWindowCount() {
        var keys = FnTwice(hold: false)
        #expect(keys.fn(down: true, at: 0) == nil)
        #expect(keys.fn(down: false, at: 0.1) == nil)
        #expect(keys.fn(down: true, at: 0.3) == .fnTwice)
        #expect(keys.fn(down: false, at: 0.35) == nil)
    }

    @Test func pressesTooFarApartDoNotCount() {
        var keys = FnTwice(hold: false)
        _ = keys.fn(down: true, at: 0)
        _ = keys.fn(down: false, at: 0.1)
        #expect(keys.fn(down: true, at: 0.6) == nil)
        _ = keys.fn(down: false, at: 0.7)
        #expect(keys.fn(down: true, at: 0.9) == .fnTwice)
    }

    @Test func fnWithAnotherKeyBetweenDoesNotCount() {
        var keys = FnTwice(hold: false)
        _ = keys.fn(down: true, at: 0)
        keys.otherKey()
        _ = keys.fn(down: false, at: 0.1)
        #expect(keys.fn(down: true, at: 0.2) == nil)
    }

    @Test func aThirdPressStartsAFreshPair() {
        var keys = FnTwice(hold: false)
        _ = keys.fn(down: true, at: 0)
        _ = keys.fn(down: false, at: 0.05)
        #expect(keys.fn(down: true, at: 0.1) == .fnTwice)
        _ = keys.fn(down: false, at: 0.15)
        #expect(keys.fn(down: true, at: 0.2) == nil)
    }

    @Test func holdReportsKeyDownThenKeyUp() {
        var keys = FnTwice(hold: true)
        _ = keys.fn(down: true, at: 0)
        _ = keys.fn(down: false, at: 0.1)
        #expect(keys.fn(down: true, at: 0.2) == .keyDown)
        #expect(keys.fn(down: true, at: 0.3) == nil)
        #expect(keys.fn(down: false, at: 2.0) == .keyUp)
    }
}

@Suite struct TextTests {
    @Test func whisperMarkersAreDropped() {
        #expect(cleanTranscript(" [BLANK_AUDIO] ") == "")
        #expect(cleanTranscript("Open the (upbeat music) dashboards  chat") == "Open the dashboards chat")
    }

    @Test func requestsAreValidated() {
        #expect(parseRequest(#"{"id":"1","op":"listen","purpose":"forever"}"#) == .failure(ParseFailure(id: "1")))
        #expect(parseRequest(#"{"op":"status"}"#) == .failure(ParseFailure(id: nil)))
        let long = String(repeating: "a", count: 2_000)
        guard case .success(let envelope) = parseRequest(#"{"id":"2","op":"listen","purpose":"command","hint":"\#(long)"}"#),
              case .listen(let listen) = envelope.request
        else { Issue.record("not a listen"); return }
        #expect(listen.hint.count == 600)
        #expect(listen.language == "en")
    }

    @Test func messagesAreOneLineOfJson() throws {
        let line = encode(id: "a", .final(text: "who needs me\n", reason: .paused))
        #expect(!line.contains("\n"))
        let object = try #require(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        #expect(object["event"] as? String == "final")
        #expect(object["reason"] as? String == "paused")
    }
}
