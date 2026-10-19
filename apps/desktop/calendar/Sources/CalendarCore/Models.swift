import Foundation

public enum Limits {
    public static let id = 100
    public static let calendarId = 300
    public static let eventId = 500
    public static let shortText = 300
    public static let title = 1_000
    public static let longText = 2_000
    public static let notes = 20_000
    public static let message = 500
    public static let events = 2_000
    public static let calendars = 500
    public static let calendarIds = 500
    public static let noteLinks = 20
    public static let attendees = 500
    public static let attendeeCount = 10_000
    public static let alarms = 20
    public static let alarmMinutes = 40_320
}

public enum Authorization: String, Encodable, Equatable {
    case notDetermined, denied, restricted, fullAccess, writeOnly
}

public enum SourceKind: String, Encodable, Equatable {
    case local, exchange, caldav, mobileme, subscribed, birthdays, other
}

public enum Ownership: String, Encodable, Equatable {
    case mine, shared, unknown
}

public enum MyStatus: String, Encodable, Equatable {
    case accepted, declined, tentative, pending, none
}

public enum Availability: String, Encodable, Equatable {
    case busy, free, tentative, unavailable, notSupported
}

public struct StoreCalendar: Equatable {
    public var id: String
    public var title: String
    public var sourceId: String
    public var sourceTitle: String
    public var sourceKind: SourceKind
    public var sourceIsDelegate: Bool
    public var color: String
    public var subscribed: Bool
    public var writable: Bool
    public var isDefault: Bool

    public init(id: String, title: String, sourceId: String, sourceTitle: String, sourceKind: SourceKind, sourceIsDelegate: Bool, color: String, subscribed: Bool, writable: Bool, isDefault: Bool) {
        self.id = id
        self.title = title
        self.sourceId = sourceId
        self.sourceTitle = sourceTitle
        self.sourceKind = sourceKind
        self.sourceIsDelegate = sourceIsDelegate
        self.color = color
        self.subscribed = subscribed
        self.writable = writable
        self.isDefault = isDefault
    }
}

public struct StoreParticipant: Equatable {
    public var name: String
    public var email: String?
    public var isCurrentUser: Bool
    public var status: MyStatus
    public var room: Bool

    public init(name: String, email: String? = nil, isCurrentUser: Bool, status: MyStatus, room: Bool = false) {
        self.name = name
        self.email = email
        self.isCurrentUser = isCurrentUser
        self.status = status
        self.room = room
    }
}

public struct StoreEvent: Equatable {
    public var id: String
    public var uid: String?
    public var start: Date
    public var end: Date
    public var allDay: Bool
    public var title: String
    public var calendarId: String
    public var url: String?
    public var location: String?
    public var notes: String?
    public var attendees: [StoreParticipant]
    public var organizerIsCurrentUser: Bool
    public var availability: Availability
    public var recurring: Bool
    public var alarms: [Int]

    public init(id: String, uid: String? = nil, start: Date, end: Date, allDay: Bool = false, title: String, calendarId: String, url: String? = nil, location: String? = nil, notes: String? = nil, attendees: [StoreParticipant] = [], organizerIsCurrentUser: Bool = false, availability: Availability = .busy, recurring: Bool = false, alarms: [Int] = []) {
        self.id = id
        self.uid = uid
        self.start = start
        self.end = end
        self.allDay = allDay
        self.title = title
        self.calendarId = calendarId
        self.url = url
        self.location = location
        self.notes = notes
        self.attendees = attendees
        self.organizerIsCurrentUser = organizerIsCurrentUser
        self.availability = availability
        self.recurring = recurring
        self.alarms = alarms
    }
}

public enum EditSpan: String, Equatable {
    case this
    case future
}

public enum AlarmChange: Equatable {
    case keep
    case none
    case minutesBefore(Int)
}

public struct EventChange: Equatable {
    public var title: String?
    public var start: Date?
    public var end: Date?
    public var allDay: Bool?
    public var notes: String?
    public var location: String?
    public var alarm: AlarmChange

    public init(title: String? = nil, start: Date? = nil, end: Date? = nil, allDay: Bool? = nil, notes: String? = nil, location: String? = nil, alarm: AlarmChange = .keep) {
        self.title = title
        self.start = start
        self.end = end
        self.allDay = allDay
        self.notes = notes
        self.location = location
        self.alarm = alarm
    }
}

public struct SaveRequest: Equatable {
    public var calendarId: String
    public var eventId: String?
    public var occurrence: Date?
    public var change: EventChange
    public var span: EditSpan
}

public protocol CalendarStore: AnyObject {
    func authorization() -> Authorization
    func requestAccess(_ done: @escaping (Authorization) -> Void)
    func calendars() -> [StoreCalendar]
    func events(from: Date, to: Date, calendarIds: [String]?) -> [StoreEvent]
    func occurrences(of eventId: String, around start: Date) -> [StoreEvent]
    func open(eventId: String) -> Bool
    func create(in calendarId: String, change: EventChange) throws -> StoreEvent
    func update(_ event: StoreEvent, change: EventChange, span: EditSpan) throws -> StoreEvent
    func remove(_ event: StoreEvent, span: EditSpan) throws
}

extension KeyedEncodingContainer {
    mutating func encodeNullable<Value: Encodable>(_ value: Value?, forKey key: Key) throws {
        if let value {
            try encode(value, forKey: key)
        } else {
            try encodeNil(forKey: key)
        }
    }
}

func clip(_ text: String, _ limit: Int) -> String {
    guard text.utf16.count > limit else { return text }
    var clipped = String(text.prefix(limit))
    while clipped.utf16.count > limit { clipped.removeLast() }
    return clipped
}
