import Foundation

public let fallbackColor = "#8E8E93"

public func ownership(of calendar: StoreCalendar) -> Ownership {
    if calendar.sourceIsDelegate || calendar.subscribed || !calendar.writable { return .shared }
    switch calendar.sourceKind {
    case .subscribed, .birthdays: return .shared
    case .local: return .mine
    default: return calendar.isDefault ? .mine : .unknown
    }
}

public func hexColor(red: Double, green: Double, blue: Double) -> String {
    let channel = { (value: Double) in Int((min(max(value, 0), 1) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", channel(red), channel(green), channel(blue))
}

func isValidColor(_ color: String) -> Bool {
    color.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil
}

func helperCalendar(_ calendar: StoreCalendar) -> HelperCalendar? {
    guard !calendar.id.isEmpty, calendar.id.utf16.count <= Limits.calendarId else { return nil }
    return HelperCalendar(
        id: calendar.id,
        title: clip(calendar.title, Limits.shortText),
        sourceId: clip(calendar.sourceId, Limits.shortText),
        sourceTitle: clip(calendar.sourceTitle, Limits.shortText),
        sourceKind: calendar.sourceKind,
        color: isValidColor(calendar.color) ? calendar.color : fallbackColor,
        subscribed: calendar.subscribed,
        writable: calendar.writable,
        ownership: ownership(of: calendar)
    )
}

func isListable(_ event: StoreEvent) -> Bool {
    !event.id.isEmpty && event.id.utf16.count <= Limits.eventId
        && !event.calendarId.isEmpty && event.calendarId.utf16.count <= Limits.calendarId
}

func helperEvent(_ event: StoreEvent) -> HelperEvent {
    let others = event.attendees.contains { !$0.isCurrentUser }
    let me = event.attendees.first { $0.isCurrentUser }
    return HelperEvent(
        id: event.id,
        uid: fitting(event.uid, Limits.eventId),
        start: isoString(event.start),
        end: isoString(event.end),
        allDay: event.allDay,
        title: clip(event.title, Limits.title),
        calendarId: event.calendarId,
        url: fitting(event.url, Limits.longText),
        location: nonEmpty(event.location).map { clip($0, Limits.longText) },
        noteLinks: noteLinks(in: event.notes ?? ""),
        hasNotes: nonEmpty(event.notes) != nil,
        attendeeCount: min(event.attendees.count, Limits.attendeeCount),
        othersInvited: others,
        myStatus: me?.status ?? .none,
        availability: event.availability,
        recurring: event.recurring
    )
}

func helperDetail(_ event: StoreEvent) -> HelperEventDetail {
    HelperEventDetail(
        event: helperEvent(event),
        notes: clip(event.notes ?? "", Limits.notes),
        attendees: event.attendees.prefix(Limits.attendees).map { attendee in
            HelperAttendee(name: clip(attendee.name, Limits.shortText), isMe: attendee.isCurrentUser, status: attendee.status)
        },
        organizerIsMe: event.organizerIsCurrentUser,
        alarms: Array(event.alarms.prefix(Limits.alarms))
    )
}

private func nonEmpty(_ text: String?) -> String? {
    guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    return text
}

private func fitting(_ text: String?, _ limit: Int) -> String? {
    guard let text = nonEmpty(text), text.utf16.count <= limit else { return nil }
    return text
}
