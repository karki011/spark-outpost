import Foundation
import Testing
@testable import CalendarCore

@Suite struct WriteTests {
    private func store() -> FakeStore {
        let store = FakeStore()
        store.storedCalendars = [calendar("cal"), calendar("ro", writable: false)]
        return store
    }

    private func times(_ from: Int, _ to: Int) -> String {
        #""start":"\#(isoString(at(from)))","end":"\#(isoString(at(to)))""#
    }

    @Test func createMakesAnEventAndReturnsItAfter() throws {
        let store = store()
        let line = #"{"id":"c","op":"save","calendarId":"cal","fields":{"title":"Spark 1b test",\#(times(0, 30)),"alarmMinutes":10}}"#
        let result = try send(line, to: store).result()
        #expect(result["before"] is NSNull)
        let after = try #require(result["after"] as? [String: Any])
        #expect((after["event"] as? [String: Any])?["title"] as? String == "Spark 1b test")
        #expect(after["alarms"] as? [Int] == [10])
        #expect(store.storedEvents.count == 1)
    }

    @Test func createNeedsTitleTimesAndAWritableCalendar() throws {
        let store = store()
        let missing = try send(#"{"id":"c","op":"save","calendarId":"cal","fields":{"title":"x"}}"#, to: store).object()
        #expect(missing["code"] as? String == "invalid")
        let backwards = try send(#"{"id":"c","op":"save","calendarId":"cal","fields":{"title":"x",\#(times(30, 0))}}"#, to: store).object()
        #expect(backwards["code"] as? String == "invalid")
        let readOnly = try send(#"{"id":"c","op":"save","calendarId":"ro","fields":{"title":"x",\#(times(0, 30))}}"#, to: store).object()
        #expect(readOnly["message"] as? String == "that calendar is read-only")
        let unknown = try send(#"{"id":"c","op":"save","calendarId":"nope","fields":{"title":"x",\#(times(0, 30))}}"#, to: store).object()
        #expect(unknown["code"] as? String == "not_found")
        #expect(store.storedEvents.isEmpty)
    }

    @Test func updateMovesTheOccurrenceAndReturnsBeforeAndAfter() throws {
        let store = store()
        store.storedEvents = [event("e", 0, 30)]
        let line = #"{"id":"u","op":"save","calendarId":"cal","eventId":"e","occurrence":"\#(isoString(at(0)))","fields":{\#(times(60, 90)),"alarmMinutes":null}}"#
        let result = try send(line, to: store).result()
        let before = try #require((result["before"] as? [String: Any])?["event"] as? [String: Any])
        let after = try #require((result["after"] as? [String: Any])?["event"] as? [String: Any])
        #expect(before["start"] as? String == isoString(at(0)))
        #expect(after["start"] as? String == isoString(at(60)))
        #expect(store.savedSpans == [.this])
    }

    @Test func futureSpanOnlyAppliesToRecurringEvents() throws {
        let store = store()
        var daily = event("d", 0, 15)
        daily.recurring = true
        store.storedEvents = [daily, event("once", 100, 110)]
        _ = send(#"{"id":"u","op":"save","calendarId":"cal","eventId":"d","occurrence":"\#(isoString(at(0)))","span":"future","fields":{"title":"New"}}"#, to: store)
        _ = send(#"{"id":"u","op":"save","calendarId":"cal","eventId":"once","occurrence":"\#(isoString(at(100)))","span":"future","fields":{"title":"New"}}"#, to: store)
        #expect(store.savedSpans == [.future, .this])
    }

    @Test func updateRefusesAnotherCalendarAndAMissingOccurrence() throws {
        let store = store()
        store.storedCalendars.append(calendar("other"))
        store.storedEvents = [event("e", 0, 30)]
        let other = try send(#"{"id":"u","op":"save","calendarId":"other","eventId":"e","occurrence":"\#(isoString(at(0)))","fields":{"title":"x"}}"#, to: store).object()
        #expect(other["message"] as? String == "that event is on another calendar")
        let gone = try send(#"{"id":"u","op":"save","calendarId":"cal","eventId":"e","occurrence":"\#(isoString(at(5)))","fields":{"title":"x"}}"#, to: store).object()
        #expect(gone["code"] as? String == "not_found")
    }

    @Test func removeDeletesTheOccurrence() throws {
        let store = store()
        store.storedEvents = [event("e", 0, 30)]
        let result = try send(#"{"id":"r","op":"remove","eventId":"e","start":"\#(isoString(at(0)))"}"#, to: store).result()
        #expect(result["removed"] as? Bool == true)
        #expect(store.storedEvents.isEmpty)
        #expect(store.removed.map { $0.1 } == [.this])
    }

    @Test func writesNeedFullAccess() throws {
        let store = store()
        store.status = .writeOnly
        store.storedEvents = [event("e", 0, 30)]
        let answer = try send(#"{"id":"r","op":"remove","eventId":"e","start":"\#(isoString(at(0)))"}"#, to: store).object()
        #expect(answer["code"] as? String == "not_authorized")
        #expect(store.storedEvents.count == 1)
    }

    @Test func aStoreRefusalIsAFailure() throws {
        let store = store()
        store.refuse = true
        let answer = try send(#"{"id":"c","op":"save","calendarId":"cal","fields":{"title":"x",\#(times(0, 30))}}"#, to: store).object()
        #expect(answer["code"] as? String == "failed")
    }

    @Test func badWriteRequestsAreInvalid() throws {
        for line in [
            #"{"id":"x","op":"save","calendarId":"cal"}"#,
            #"{"id":"x","op":"save","calendarId":"cal","fields":{},"span":"all"}"#,
            #"{"id":"x","op":"save","calendarId":"cal","fields":{"alarmMinutes":-5}}"#,
            #"{"id":"x","op":"save","calendarId":"cal","eventId":"e","fields":{}}"#,
            #"{"id":"x","op":"remove","eventId":"e"}"#,
        ] {
            #expect(try send(line, to: store()).object()["code"] as? String == "invalid")
        }
    }
}
