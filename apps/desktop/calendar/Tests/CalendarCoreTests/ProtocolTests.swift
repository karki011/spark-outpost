import Foundation
import Testing
@testable import CalendarCore

@Suite struct ProtocolTests {
    @Test func unparsableLinesAnswerInvalidWithANullId() throws {
        for line in ["not json", "[1,2]", #"{"op":"status"}"#, #"{"id":"","op":"status"}"#, #"{"id":7,"op":"status"}"#, "{\"id\":\"\(String(repeating: "x", count: 101))\",\"op\":\"status\"}"] {
            let answer = try send(line, to: FakeStore()).object()
            #expect(answer["id"] is NSNull)
            #expect(answer["ok"] as? Bool == false)
            #expect(answer["code"] as? String == "invalid")
        }
    }

    @Test func badFieldsAnswerInvalidWithTheirId() throws {
        let lines = [
            #"{"id":"a","op":"nope"}"#,
            #"{"id":"a"}"#,
            #"{"id":"a","op":"events","from":"yesterday","to":"2027-01-01T00:00:00Z"}"#,
            #"{"id":"a","op":"events","from":"2027-01-02T00:00:00Z","to":"2027-01-01T00:00:00Z"}"#,
            #"{"id":"a","op":"events","from":"2027-01-01T00:00:00Z","to":"2027-01-02T00:00:00Z","calendarIds":[1]}"#,
            #"{"id":"a","op":"event","start":"2027-01-01T00:00:00Z"}"#,
            #"{"id":"a","op":"open","eventId":"e"}"#,
        ]
        for line in lines {
            let answer = try send(line, to: FakeStore()).object()
            #expect(answer["id"] as? String == "a")
            #expect(answer["code"] as? String == "invalid")
        }
    }

    @Test func parsesDatesWithOffsetsAndFractionalSeconds() {
        let parsed = parseRequestLine(#"{"id":"e","op":"events","from":"2027-01-01T09:00:00+02:00","to":"2027-01-01T08:00:00.500Z","calendarIds":["a"]}"#)
        let from = Date(timeIntervalSince1970: 1_798_786_800)
        #expect(parsed == .request(id: "e", .events(from: from, to: from.addingTimeInterval(3_600.5), calendarIds: ["a"])))
    }

    @Test func emitsDatesWithAnOffset() {
        let text = isoString(base)
        #expect(text.range(of: #"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$"#, options: .regularExpression) != nil)
        #expect(parseInstant(text) == base)
    }

    @Test func absentOptionalsAreNullNotMissing() throws {
        let store = FakeStore()
        store.storedEvents = [event("e1", 0, 30)]
        let events = try #require(try send(#"{"id":"1","op":"events","from":"2020-01-01T00:00:00Z","to":"2030-01-01T00:00:00Z"}"#, to: store).result()["events"] as? [[String: Any]])
        for key in ["uid", "url", "location"] {
            #expect(events[0][key] is NSNull)
        }
        #expect(events[0]["hasNotes"] as? Bool == false)
        #expect(events[0]["noteLinks"] as? [String] == [])
    }

    @Test func eachAnswerIsOneLine() {
        let store = FakeStore()
        store.storedEvents = [StoreEvent(id: "e", start: at(0), end: at(1), title: "a\nb", calendarId: "cal", notes: "x\ny")]
        let captured = send(#"{"id":"1","op":"event","eventId":"e","start":"\#(isoString(at(0)))"}"#, to: store)
        #expect(captured.lines.count == 1)
        #expect(!captured.lines[0].contains("\n"))
    }

    @Test func changedLineIsTheEventShape() throws {
        let parsed = try JSONSerialization.jsonObject(with: Data(changedLine.utf8)) as? [String: String]
        #expect(parsed == ["event": "changed"])
    }

    @Test func failureMessagesAreClipped() throws {
        let line = failureLine(id: "x", error: OpError(.failed, String(repeating: "m", count: 900)))
        let parsed = try #require(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        #expect((parsed["message"] as? String)?.count == Limits.message)
        #expect(parsed["code"] as? String == "failed")
    }
}
