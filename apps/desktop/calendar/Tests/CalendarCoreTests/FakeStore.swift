import Foundation
@testable import CalendarCore

final class FakeStore: CalendarStore {
    var status: Authorization = .fullAccess
    var granted: Authorization = .fullAccess
    var pendingRequest: ((Authorization) -> Void)?
    var storedCalendars: [StoreCalendar] = []
    var storedEvents: [StoreEvent] = []
    var openedIds: [String] = []
    var lastCalendarIds: [String]??

    func authorization() -> Authorization { status }

    func requestAccess(_ done: @escaping (Authorization) -> Void) {
        pendingRequest = done
    }

    func grant() {
        status = granted
        pendingRequest?(granted)
        pendingRequest = nil
    }

    func calendars() -> [StoreCalendar] { storedCalendars }

    func events(from: Date, to: Date, calendarIds: [String]?) -> [StoreEvent] {
        lastCalendarIds = .some(calendarIds)
        return storedEvents.filter { event in
            event.start < to && event.end > from && (calendarIds?.contains(event.calendarId) ?? true)
        }
    }

    func occurrences(of eventId: String, around start: Date) -> [StoreEvent] {
        storedEvents.filter { $0.id == eventId }
    }

    func open(eventId: String) -> Bool {
        openedIds.append(eventId)
        return true
    }
}

let base = Date(timeIntervalSince1970: 1_800_000_000)

func at(_ minutes: Int) -> Date {
    base.addingTimeInterval(TimeInterval(minutes * 60))
}

func calendar(_ id: String, kind: SourceKind = .local, writable: Bool = true, subscribed: Bool = false, delegate: Bool = false, isDefault: Bool = false) -> StoreCalendar {
    StoreCalendar(id: id, title: "Calendar \(id)", sourceId: "src", sourceTitle: "On My Mac", sourceKind: kind, sourceIsDelegate: delegate, color: "#1E90FF", subscribed: subscribed, writable: writable, isDefault: isDefault)
}

func event(_ id: String, _ from: Int, _ to: Int, calendarId: String = "cal") -> StoreEvent {
    StoreEvent(id: id, start: at(from), end: at(to), title: "Event \(id)", calendarId: calendarId)
}

final class Captured {
    var lines: [String] = []

    func object(_ index: Int = 0) throws -> [String: Any] {
        let parsed = try JSONSerialization.jsonObject(with: Data(lines[index].utf8))
        guard let object = parsed as? [String: Any] else { throw CocoaError(.coderReadCorrupt) }
        return object
    }

    func result(_ index: Int = 0) throws -> [String: Any] {
        guard let result = try object(index)["result"] as? [String: Any] else { throw CocoaError(.coderValueNotFound) }
        return result
    }
}

func send(_ line: String, to store: FakeStore) -> Captured {
    let captured = Captured()
    respond(to: line, engine: Engine(store: store)) { captured.lines.append($0) }
    return captured
}
