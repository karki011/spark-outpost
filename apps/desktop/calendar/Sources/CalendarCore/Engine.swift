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
