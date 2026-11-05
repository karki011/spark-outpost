import Foundation

public enum ErrorCode: String, Encodable {
    case invalid
    case notAuthorized = "not_authorized"
    case notFound = "not_found"
    case failed
}

public struct OpError: Error, Equatable {
    public let code: ErrorCode
    public let message: String

    public init(_ code: ErrorCode, _ message: String) {
        self.code = code
        self.message = message
    }
}

public typealias Reply = (Result<OpResult, OpError>) -> Void

public final class Engine {
    let store: CalendarStore

    public init(store: CalendarStore) {
        self.store = store
    }

    public func handle(_ request: Request, reply: @escaping Reply) {
        switch request {
        case .status:
            reply(.success(.authorization(store.authorization())))
        case .request:
            store.requestAccess { reply(.success(.authorization($0))) }
        default:
            reply(Result { try handleAuthorized(request) }.mapError(opError))
        }
    }

    private func handleAuthorized(_ request: Request) throws -> OpResult {
        guard store.authorization() == .fullAccess else {
            throw OpError(.notAuthorized, "Spark Outpost does not have full access to Calendars")
        }
        switch request {
        case .calendars:
            return .calendars(Array(store.calendars().compactMap(helperCalendar).prefix(Limits.calendars)))
        case .events(let from, let to, let calendarIds):
            return events(from: from, to: to, calendarIds: calendarIds)
        case .event(let eventId, let start):
            return .event(helperDetail(try occurrence(eventId, start)))
        case .open(let eventId, let start):
            let event = try occurrence(eventId, start)
            return .opened(store.open(eventId: event.id))
        case .save(let save):
            return try saved(save)
        case .remove(let eventId, let start, let span):
            let event = try occurrence(eventId, start)
            try writableCalendar(event.calendarId)
            try store.remove(event, span: spanFor(event, span))
            return .removed
        case .status, .request:
            throw OpError(.invalid, "unexpected op")
        }
    }

    private func events(from: Date, to: Date, calendarIds: [String]?) -> OpResult {
        if let calendarIds, calendarIds.isEmpty { return .events([], truncated: false) }
        let found = store.events(from: from, to: to, calendarIds: calendarIds)
            .filter(isListable)
            .sorted { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }
        let kept = found.prefix(Limits.events).map(helperEvent)
        return .events(kept, truncated: found.count > Limits.events)
    }

    private func saved(_ save: SaveRequest) throws -> OpResult {
        try writableCalendar(save.calendarId)
        guard let eventId = save.eventId, let start = save.occurrence else {
            return .saved(before: nil, after: helperDetail(try created(save)))
        }
        let before = try occurrence(eventId, start)
        guard before.calendarId == save.calendarId else {
            throw OpError(.invalid, "that event is on another calendar")
        }
        try checkTimes(save.change, start: before.start, end: before.end)
        let after = try store.update(before, change: save.change, span: spanFor(before, save.span))
        return .saved(before: helperDetail(before), after: helperDetail(after))
    }

    private func created(_ save: SaveRequest) throws -> StoreEvent {
        guard let title = save.change.title, !title.trimmingCharacters(in: .whitespaces).isEmpty,
              let start = save.change.start, let end = save.change.end else {
            throw OpError(.invalid, "a new event needs a title, start and end")
        }
        try checkTimes(save.change, start: start, end: end)
        return try store.create(in: save.calendarId, change: save.change)
    }

    private func checkTimes(_ change: EventChange, start: Date, end: Date) throws {
        let from = change.start ?? start
        let to = change.end ?? end
        guard to > from else { throw OpError(.invalid, "the end must be after the start") }
    }

    private func writableCalendar(_ calendarId: String) throws {
        guard let calendar = store.calendars().first(where: { $0.id == calendarId }) else {
            throw OpError(.notFound, "no calendar with that id")
        }
        guard calendar.writable else { throw OpError(.invalid, "that calendar is read-only") }
    }

    private func spanFor(_ event: StoreEvent, _ span: EditSpan) -> EditSpan {
        event.recurring ? span : .this
    }

    private func occurrence(_ eventId: String, _ start: Date) throws -> StoreEvent {
        let match = store.occurrences(of: eventId, around: start).first { candidate in
            candidate.id == eventId && sameInstant(candidate.start, start)
        }
        guard let match, isListable(match) else {
            throw OpError(.notFound, "no event with that id starts at that time")
        }
        return match
    }
}

private func opError(_ error: Error) -> OpError {
    error as? OpError ?? OpError(.failed, "the calendar request failed")
}
