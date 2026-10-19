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
        ekOccurrences(of: eventId, around: start).map(storeEvent)
    }

    func create(in calendarId: String, change: EventChange) throws -> StoreEvent {
        guard let calendar = store.calendar(withIdentifier: calendarId) else {
            throw OpError(.notFound, "no calendar with that id")
        }
        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        apply(change, to: event)
        try commit { try store.save(event, span: .thisEvent, commit: true) }
        return storeEvent(event)
    }

    func update(_ found: StoreEvent, change: EventChange, span: EditSpan) throws -> StoreEvent {
        let event = try ekOccurrence(found)
        apply(change, to: event)
        try commit { try store.save(event, span: ekSpan(span), commit: true) }
        return storeEvent(event)
    }

    func remove(_ found: StoreEvent, span: EditSpan) throws {
        let event = try ekOccurrence(found)
        try commit { try store.remove(event, span: ekSpan(span), commit: true) }
    }

    private func ekOccurrences(of eventId: String, around start: Date) -> [EKEvent] {
        guard let item = store.calendarItem(withIdentifier: eventId) as? EKEvent, let calendar = item.calendar else {
            return []
        }
        let predicate = store.predicateForEvents(withStart: start.addingTimeInterval(-1), end: start.addingTimeInterval(1), calendars: [calendar])
        return store.events(matching: predicate).filter { $0.calendarItemIdentifier == eventId }
    }

    private func ekOccurrence(_ found: StoreEvent) throws -> EKEvent {
        let match = ekOccurrences(of: found.id, around: found.start).first {
            abs($0.startDate.timeIntervalSince(found.start)) < 1
        }
        guard let match else { throw OpError(.notFound, "no event with that id starts at that time") }
        return match
    }

    func open(eventId: String) -> Bool {
        if let url = calendarEventURL(eventId), NSWorkspace.shared.open(url) { return true }
        guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.iCal") else { return false }
        return NSWorkspace.shared.open(app)
    }
}

private func commit(_ work: () throws -> Void) throws {
    do {
        try work()
    } catch let error as OpError {
        throw error
    } catch {
        throw OpError(.failed, "Calendar refused the change: \(error.localizedDescription)")
    }
}

private func ekSpan(_ span: EditSpan) -> EKSpan {
    span == .future ? .futureEvents : .thisEvent
}

private func apply(_ change: EventChange, to event: EKEvent) {
    if let title = change.title { event.title = title }
    if let allDay = change.allDay { event.isAllDay = allDay }
    if let start = change.start { event.startDate = start }
    if let end = change.end { event.endDate = end }
    if let notes = change.notes { event.notes = notes.isEmpty ? nil : notes }
    if let location = change.location { event.location = location.isEmpty ? nil : location }
    switch change.alarm {
    case .keep: break
    case .none: event.alarms = nil
    case .minutesBefore(let minutes): event.alarms = [EKAlarm(relativeOffset: -TimeInterval(minutes * 60))]
    }
}

private func alarmMinutes(_ event: EKEvent) -> [Int] {
    (event.alarms ?? []).compactMap { alarm in
        alarm.absoluteDate == nil && alarm.relativeOffset <= 0 ? Int((-alarm.relativeOffset / 60).rounded()) : nil
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
        recurring: event.hasRecurrenceRules,
        alarms: alarmMinutes(event)
    )
}

private func participant(_ participant: EKParticipant) -> StoreParticipant {
    let email = participant.url.scheme == "mailto" ? (participant.url as NSURL).resourceSpecifier : nil
    return StoreParticipant(
        name: participant.name ?? email ?? "",
        email: email,
        isCurrentUser: participant.isCurrentUser,
        status: participantStatus(participant.participantStatus),
        room: participant.participantType == .room || participant.participantType == .resource
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
