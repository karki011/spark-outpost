import AppKit
import CalendarCore
import EventKit

final class EventKitStore: CalendarStore {
    let store = EKEventStore()

    func authorization() -> Authorization {
        authorizationValue(EKEventStore.authorizationStatus(for: .event))
    }

    func requestAccess(_ done: @escaping (Authorization) -> Void) {
        let finish = { (_: Bool, _: Error?) in
            DispatchQueue.main.async {
                let authorization = self.authorization()
                if authorization == .fullAccess { self.store.reset() }
                done(authorization)
            }
        }
        if #available(macOS 14, *) {
            store.requestFullAccessToEvents(completion: finish)
        } else {
            store.requestAccess(to: .event, completion: finish)
        }
    }

    func calendars() -> [StoreCalendar] {
        let defaultId = store.defaultCalendarForNewEvents?.calendarIdentifier
        return store.calendars(for: .event).map { storeCalendar($0, defaultId: defaultId) }
    }

    func events(from: Date, to: Date, calendarIds: [String]?) -> [StoreEvent] {
        var calendars: [EKCalendar]?
        if let calendarIds {
            let wanted = Set(calendarIds)
            calendars = store.calendars(for: .event).filter { wanted.contains($0.calendarIdentifier) }
            if calendars?.isEmpty ?? true { return [] }
        }
        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars)
        return store.events(matching: predicate).map(storeEvent)
    }

    func occurrences(of eventId: String, around start: Date) -> [StoreEvent] {
        guard let item = store.calendarItem(withIdentifier: eventId) as? EKEvent, let calendar = item.calendar else {
            return []
        }
        let predicate = store.predicateForEvents(withStart: start.addingTimeInterval(-1), end: start.addingTimeInterval(1), calendars: [calendar])
        return store.events(matching: predicate)
            .filter { $0.calendarItemIdentifier == eventId }
            .map(storeEvent)
    }

    func open(eventId: String) -> Bool {
        if let url = calendarEventURL(eventId), NSWorkspace.shared.open(url) { return true }
        guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.iCal") else { return false }
        return NSWorkspace.shared.open(app)
    }
}

func authorizationValue(_ status: EKAuthorizationStatus) -> Authorization {
    switch status {
    case .notDetermined: return .notDetermined
    case .restricted: return .restricted
    case .denied: return .denied
    default: return grantedAuthorization(status)
    }
}

private func grantedAuthorization(_ status: EKAuthorizationStatus) -> Authorization {
    if #available(macOS 14, *) {
        switch status {
        case .fullAccess: return .fullAccess
        case .writeOnly: return .writeOnly
        default: return .denied
        }
    }
    return status == .authorized ? .fullAccess : .denied
}

private func calendarEventURL(_ eventId: String) -> URL? {
    guard let encoded = eventId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
    return URL(string: "ical://ekevent/\(encoded)?method=show&options=more")
}

private func storeCalendar(_ calendar: EKCalendar, defaultId: String?) -> StoreCalendar {
    let source = calendar.source
    return StoreCalendar(
        id: calendar.calendarIdentifier,
        title: calendar.title,
        sourceId: source?.sourceIdentifier ?? "",
        sourceTitle: source?.title ?? "",
        sourceKind: source.map { sourceKind($0.sourceType) } ?? .other,
        sourceIsDelegate: source.map(isDelegate) ?? false,
        color: colorHex(calendar.cgColor),
        subscribed: calendar.isSubscribed || calendar.type == .subscription,
        writable: calendar.allowsContentModifications,
        isDefault: calendar.calendarIdentifier == defaultId
    )
}

private func isDelegate(_ source: EKSource) -> Bool {
    guard #available(macOS 13, *) else { return false }
    return source.isDelegate
}

private func sourceKind(_ type: EKSourceType) -> SourceKind {
    switch type {
    case .local: return .local
    case .exchange: return .exchange
    case .calDAV: return .caldav
    case .mobileMe: return .mobileme
    case .subscribed: return .subscribed
    case .birthdays: return .birthdays
    @unknown default: return .other
    }
}

private func colorHex(_ color: CGColor?) -> String {
    guard let color, let rgb = NSColor(cgColor: color)?.usingColorSpace(.sRGB) else { return fallbackColor }
    return hexColor(red: Double(rgb.redComponent), green: Double(rgb.greenComponent), blue: Double(rgb.blueComponent))
}

private func storeEvent(_ event: EKEvent) -> StoreEvent {
    StoreEvent(
        id: event.calendarItemIdentifier,
        uid: event.calendarItemExternalIdentifier,
        start: event.startDate,
        end: event.endDate,
        allDay: event.isAllDay,
        title: event.title ?? "",
        calendarId: event.calendar?.calendarIdentifier ?? "",
        url: event.url?.absoluteString,
        location: event.location,
        notes: event.notes,
        attendees: (event.attendees ?? []).map(participant),
        organizerIsCurrentUser: event.organizer?.isCurrentUser ?? false,
        availability: availability(event.availability),
        recurring: event.hasRecurrenceRules
    )
}

private func participant(_ participant: EKParticipant) -> StoreParticipant {
    let email = participant.url.scheme == "mailto" ? (participant.url as NSURL).resourceSpecifier : nil
    return StoreParticipant(
        name: participant.name ?? email ?? "",
        isCurrentUser: participant.isCurrentUser,
        status: participantStatus(participant.participantStatus)
    )
}

private func participantStatus(_ status: EKParticipantStatus) -> MyStatus {
    switch status {
    case .accepted: return .accepted
    case .declined: return .declined
    case .tentative: return .tentative
    case .pending: return .pending
    default: return .none
    }
}

private func availability(_ value: EKEventAvailability) -> Availability {
    switch value {
    case .busy: return .busy
    case .free: return .free
    case .tentative: return .tentative
    case .unavailable: return .unavailable
    default: return .notSupported
    }
}
