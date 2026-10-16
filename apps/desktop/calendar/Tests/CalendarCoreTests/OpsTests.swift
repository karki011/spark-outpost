import Foundation
import Testing
@testable import CalendarCore

private let wideRange = #""from":"2020-01-01T00:00:00Z","to":"2030-01-01T00:00:00Z""#

@Suite struct OpsTests {
    @Test func statusReportsTheAuthorization() throws {
        let store = FakeStore()
        store.status = .writeOnly
        let answer = send(#"{"id":"s","op":"status"}"#, to: store)
        #expect(try answer.object()["ok"] as? Bool == true)
        #expect(try answer.object()["id"] as? String == "s")
        #expect(try answer.result() as? [String: String] == ["authorization": "writeOnly"])
    }

    @Test func requestAnswersOnlyWhenTheSystemDoes() throws {
        let store = FakeStore()
        store.status = .notDetermined
        let captured = Captured()
        let engine = Engine(store: store)
        respond(to: #"{"id":"r","op":"request"}"#, engine: engine) { captured.lines.append($0) }
        respond(to: #"{"id":"s","op":"status"}"#, engine: engine) { captured.lines.append($0) }
        #expect(captured.lines.count == 1)
        #expect(try captured.result()["authorization"] as? String == "notDetermined")
        store.grant()
        #expect(captured.lines.count == 2)
        #expect(try captured.object(1)["id"] as? String == "r")
        #expect(try captured.result(1)["authorization"] as? String == "fullAccess")
    }

    @Test(arguments: [Authorization.notDetermined, .denied, .restricted, .writeOnly])
    func readsNeedFullAccess(_ status: Authorization) throws {
        let store = FakeStore()
        store.status = status
        store.storedEvents = [event("e", 0, 10)]
        let start = isoString(at(0))
        for line in [
            #"{"id":"x","op":"calendars"}"#,
            "{\"id\":\"x\",\"op\":\"events\",\(wideRange)}",
            #"{"id":"x","op":"event","eventId":"e","start":"\#(start)"}"#,
            #"{"id":"x","op":"open","eventId":"e","start":"\#(start)"}"#,
        ] {
            let answer = try send(line, to: store).object()
            #expect(answer["code"] as? String == "not_authorized")
        }
        #expect(store.openedIds.isEmpty)
    }

    @Test func calendarsCarryOwnershipAndColour() throws {
        let store = FakeStore()
        store.storedCalendars = [calendar("a"), calendar("b", kind: .caldav, writable: false), StoreCalendar(id: "", title: "", sourceId: "", sourceTitle: "", sourceKind: .other, sourceIsDelegate: false, color: "", subscribed: false, writable: true, isDefault: false)]
        let calendars = try #require(try send(#"{"id":"c","op":"calendars"}"#, to: store).result()["calendars"] as? [[String: Any]])
        #expect(calendars.count == 2)
        #expect(calendars[0]["ownership"] as? String == "mine")
        #expect(calendars[0]["color"] as? String == "#1E90FF")
        #expect(calendars[0]["sourceKind"] as? String == "local")
        #expect(calendars[1]["ownership"] as? String == "shared")
        #expect(calendars[1]["writable"] as? Bool == false)
    }

    @Test func eventsAreSortedAndMapped() throws {
        let store = FakeStore()
        var invite = event("late", 60, 90)
        invite.uid = "uid-1"
        invite.url = "https://meet.google.com/abc-defg-hij"
        invite.location = "Room 1"
        invite.recurring = true
        invite.attendees = [
            StoreParticipant(name: "Me", isCurrentUser: true, status: .tentative),
            StoreParticipant(name: "Ana", isCurrentUser: false, status: .accepted),
        ]
        store.storedEvents = [invite, event("early", 0, 30)]
        let result = try send("{\"id\":\"e\",\"op\":\"events\",\(wideRange)}", to: store).result()
        let events = try #require(result["events"] as? [[String: Any]])
        #expect(result["truncated"] as? Bool == false)
        #expect(events.map { $0["id"] as? String } == ["early", "late"])
        #expect(events[1]["uid"] as? String == "uid-1")
        #expect(events[1]["url"] as? String == "https://meet.google.com/abc-defg-hij")
        #expect(events[1]["location"] as? String == "Room 1")
        #expect(events[1]["attendeeCount"] as? Int == 2)
        #expect(events[1]["othersInvited"] as? Bool == true)
        #expect(events[1]["myStatus"] as? String == "tentative")
        #expect(events[1]["recurring"] as? Bool == true)
        #expect(events[1]["availability"] as? String == "busy")
        #expect(events[0]["myStatus"] as? String == "none")
        #expect(events[0]["othersInvited"] as? Bool == false)
    }

    @Test func eventsStopAtTwoThousandAndSayTruncated() throws {
        let store = FakeStore()
        store.storedEvents = (0..<2_001).reversed().map { event("e\($0)", $0, $0 + 1) }
        let result = try send("{\"id\":\"e\",\"op\":\"events\",\(wideRange)}", to: store).result()
        let events = try #require(result["events"] as? [[String: Any]])
        #expect(events.count == 2_000)
        #expect(result["truncated"] as? Bool == true)
        #expect(events.last?["id"] as? String == "e1999")
    }

    @Test func calendarIdsFilterAndAnEmptyListFindsNothing() throws {
        let store = FakeStore()
        store.storedEvents = [event("a", 0, 10, calendarId: "one"), event("b", 0, 10, calendarId: "two")]
        let some = try send("{\"id\":\"e\",\"op\":\"events\",\(wideRange),\"calendarIds\":[\"two\"]}", to: store).result()
        #expect((some["events"] as? [[String: Any]])?.map { $0["id"] as? String } == ["b"])
        store.lastCalendarIds = nil
        let none = try send("{\"id\":\"e\",\"op\":\"events\",\(wideRange),\"calendarIds\":[]}", to: store).result()
        #expect((none["events"] as? [[String: Any]])?.isEmpty == true)
        #expect(store.lastCalendarIds == nil)
    }

    @Test func eventFindsTheOccurrenceAtThatStart() throws {
        let store = FakeStore()
        var first = event("daily", 0, 15)
        first.notes = "Agenda https://acme.zoom.us/j/1"
        first.organizerIsCurrentUser = true
        first.attendees = [StoreParticipant(name: "Me", isCurrentUser: true, status: .accepted), StoreParticipant(name: "Bo", isCurrentUser: false, status: .declined)]
        var second = event("daily", 1_440, 1_455)
        second.notes = "Second day"
        store.storedEvents = [first, second]
        let result = try send(#"{"id":"d","op":"event","eventId":"daily","start":"\#(isoString(at(1_440)))"}"#, to: store).result()
        #expect(result["notes"] as? String == "Second day")
        let firstResult = try send(#"{"id":"d","op":"event","eventId":"daily","start":"\#(isoString(at(0)))"}"#, to: store).result()
        #expect(firstResult["notes"] as? String == "Agenda https://acme.zoom.us/j/1")
        #expect(firstResult["organizerIsMe"] as? Bool == true)
        let attendees = try #require(firstResult["attendees"] as? [[String: Any]])
        #expect(attendees.map { $0["name"] as? String } == ["Me", "Bo"])
        #expect(attendees.map { $0["isMe"] as? Bool } == [true, false])
        #expect(attendees.map { $0["status"] as? String } == ["accepted", "declined"])
        let summary = try #require(firstResult["event"] as? [String: Any])
        #expect(summary["noteLinks"] as? [String] == ["https://acme.zoom.us/j/1"])
        #expect(summary["hasNotes"] as? Bool == true)
    }

    @Test func eventAndOpenAnswerNotFoundForAnotherStart() throws {
        let store = FakeStore()
        store.storedEvents = [event("e", 0, 10)]
        for op in ["event", "open"] {
            let answer = try send(#"{"id":"n","op":"\#(op)","eventId":"e","start":"\#(isoString(at(5)))"}"#, to: store).object()
            #expect(answer["code"] as? String == "not_found")
        }
        let unknown = try send(#"{"id":"n","op":"event","eventId":"missing","start":"\#(isoString(at(0)))"}"#, to: store).object()
        #expect(unknown["code"] as? String == "not_found")
        #expect(store.openedIds.isEmpty)
    }

    @Test func openOpensTheMatchingEvent() throws {
        let store = FakeStore()
        store.storedEvents = [event("e", 0, 10)]
        let answer = send(#"{"id":"o","op":"open","eventId":"e","start":"\#(isoString(at(0)))"}"#, to: store)
        #expect(try answer.result() as? [String: Bool] == ["opened": true])
        #expect(store.openedIds == ["e"])
    }
}
