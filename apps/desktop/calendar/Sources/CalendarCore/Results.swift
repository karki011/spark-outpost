import Foundation

public struct HelperCalendar: Equatable, Encodable {
    public var id: String
    public var title: String
    public var sourceId: String
    public var sourceTitle: String
    public var sourceKind: SourceKind
    public var color: String
    public var subscribed: Bool
    public var writable: Bool
    public var ownership: Ownership
}

public struct HelperEvent: Equatable, Encodable {
    public var id: String
    public var uid: String?
    public var start: String
    public var end: String
    public var allDay: Bool
    public var title: String
    public var calendarId: String
    public var url: String?
    public var location: String?
    public var noteLinks: [String]
    public var hasNotes: Bool
    public var attendeeCount: Int
    public var othersInvited: Bool
    public var myStatus: MyStatus
    public var availability: Availability
    public var recurring: Bool

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeNullable(uid, forKey: .uid)
        try container.encode(start, forKey: .start)
        try container.encode(end, forKey: .end)
        try container.encode(allDay, forKey: .allDay)
        try container.encode(title, forKey: .title)
        try container.encode(calendarId, forKey: .calendarId)
        try container.encodeNullable(url, forKey: .url)
        try container.encodeNullable(location, forKey: .location)
        try container.encode(noteLinks, forKey: .noteLinks)
        try container.encode(hasNotes, forKey: .hasNotes)
        try container.encode(attendeeCount, forKey: .attendeeCount)
        try container.encode(othersInvited, forKey: .othersInvited)
        try container.encode(myStatus, forKey: .myStatus)
        try container.encode(availability, forKey: .availability)
        try container.encode(recurring, forKey: .recurring)
    }

    private enum CodingKeys: String, CodingKey {
        case id, uid, start, end, allDay, title, calendarId, url, location, noteLinks, hasNotes
        case attendeeCount, othersInvited, myStatus, availability, recurring
    }
}

public struct HelperAttendee: Equatable, Encodable {
    public var name: String
    public var isMe: Bool
    public var status: MyStatus
}

public struct HelperEventDetail: Equatable, Encodable {
    public var event: HelperEvent
    public var notes: String
    public var attendees: [HelperAttendee]
    public var organizerIsMe: Bool
    public var alarms: [Int]
}

public enum OpResult: Equatable, Encodable {
    case authorization(Authorization)
    case calendars([HelperCalendar])
    case events([HelperEvent], truncated: Bool)
    case event(HelperEventDetail)
    case opened(Bool)
    case saved(before: HelperEventDetail?, after: HelperEventDetail)
    case removed

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .authorization(let authorization):
            try container.encode(authorization, forKey: .authorization)
        case .calendars(let calendars):
            try container.encode(calendars, forKey: .calendars)
        case .events(let events, let truncated):
            try container.encode(events, forKey: .events)
            try container.encode(truncated, forKey: .truncated)
        case .event(let detail):
            try detail.encode(to: encoder)
        case .opened(let opened):
            try container.encode(opened, forKey: .opened)
        case .saved(let before, let after):
            try container.encodeNullable(before, forKey: .before)
            try container.encode(after, forKey: .after)
        case .removed:
            try container.encode(true, forKey: .removed)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case authorization, calendars, events, truncated, opened, before, after, removed
    }
}
