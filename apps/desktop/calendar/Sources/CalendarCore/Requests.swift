import Foundation

public enum Request: Equatable {
    case status
    case request
    case calendars
    case events(from: Date, to: Date, calendarIds: [String]?)
    case event(eventId: String, start: Date)
    case open(eventId: String, start: Date)
    case save(SaveRequest)
    case remove(eventId: String, start: Date, span: EditSpan)
}

public enum ParsedLine: Equatable {
    case request(id: String, Request)
    case invalid(id: String?, message: String)
}

private struct InvalidRequest: Error {
    let message: String
}

public func parseRequestLine(_ line: String) -> ParsedLine {
    guard let object = jsonObject(line) else {
        return .invalid(id: nil, message: "the line is not a JSON object")
    }
    guard let id = object["id"] as? String, !id.isEmpty, id.utf16.count <= Limits.id else {
        return .invalid(id: nil, message: "the request has no valid id")
    }
    do {
        return .request(id: id, try request(from: object))
    } catch let invalid as InvalidRequest {
        return .invalid(id: id, message: invalid.message)
    } catch {
        return .invalid(id: id, message: "malformed request")
    }
}

private func jsonObject(_ line: String) -> [String: Any]? {
    guard let parsed = try? JSONSerialization.jsonObject(with: Data(line.utf8)) else { return nil }
    return parsed as? [String: Any]
}

private func request(from object: [String: Any]) throws -> Request {
    guard let op = object["op"] as? String else { throw InvalidRequest(message: "missing op") }
    switch op {
    case "status": return .status
    case "request": return .request
    case "calendars": return .calendars
    case "events": return try eventsRequest(object)
    case "event": return .event(eventId: try eventId(object), start: try instant(object, "start"))
    case "open": return .open(eventId: try eventId(object), start: try instant(object, "start"))
    case "save": return .save(try saveRequest(object))
    case "remove": return .remove(eventId: try eventId(object), start: try instant(object, "start"), span: try span(object))
    default: throw InvalidRequest(message: "unknown op")
    }
}

private func eventsRequest(_ object: [String: Any]) throws -> Request {
    let from = try instant(object, "from")
    let to = try instant(object, "to")
    guard to > from else { throw InvalidRequest(message: "to must be after from") }
    return .events(from: from, to: to, calendarIds: try calendarIds(object["calendarIds"]))
}

private func instant(_ object: [String: Any], _ name: String) throws -> Date {
    guard let text = object[name] as? String else { throw InvalidRequest(message: "missing \(name)") }
    guard let date = parseInstant(text) else { throw InvalidRequest(message: "invalid \(name)") }
    return date
}

private func eventId(_ object: [String: Any]) throws -> String {
    guard let id = object["eventId"] as? String else { throw InvalidRequest(message: "missing eventId") }
    guard !id.isEmpty, id.utf16.count <= Limits.eventId else { throw InvalidRequest(message: "invalid eventId") }
    return id
}

private func calendarIds(_ value: Any?) throws -> [String]? {
    guard let value, !(value is NSNull) else { return nil }
    guard let ids = value as? [String], ids.count <= Limits.calendarIds,
          ids.allSatisfy({ $0.utf16.count <= Limits.calendarId }) else {
        throw InvalidRequest(message: "invalid calendarIds")
    }
    return ids
}

private func saveRequest(_ object: [String: Any]) throws -> SaveRequest {
    guard let calendarId = object["calendarId"] as? String, !calendarId.isEmpty, calendarId.utf16.count <= Limits.calendarId else {
        throw InvalidRequest(message: "invalid calendarId")
    }
    guard let fields = object["fields"] as? [String: Any] else { throw InvalidRequest(message: "missing fields") }
    let existing = object["eventId"] != nil
    return SaveRequest(
        calendarId: calendarId,
        eventId: existing ? try eventId(object) : nil,
        occurrence: existing ? try instant(object, "occurrence") : nil,
        change: try eventChange(fields),
        span: try span(object)
    )
}

private func span(_ object: [String: Any]) throws -> EditSpan {
    guard let value = object["span"] else { return .this }
    guard let text = value as? String, let span = EditSpan(rawValue: text) else { throw InvalidRequest(message: "invalid span") }
    return span
}

private func eventChange(_ fields: [String: Any]) throws -> EventChange {
    EventChange(
        title: try optionalText(fields, "title", Limits.title),
        start: try fields["start"] == nil ? nil : instant(fields, "start"),
        end: try fields["end"] == nil ? nil : instant(fields, "end"),
        allDay: try optionalBool(fields, "allDay"),
        notes: try optionalText(fields, "notes", Limits.notes),
        location: try optionalText(fields, "location", Limits.longText),
        alarm: try alarm(fields)
    )
}

private func optionalText(_ object: [String: Any], _ name: String, _ limit: Int) throws -> String? {
    guard let value = object[name] else { return nil }
    guard let text = value as? String, text.utf16.count <= limit else { throw InvalidRequest(message: "invalid \(name)") }
    return text
}

private func optionalBool(_ object: [String: Any], _ name: String) throws -> Bool? {
    guard let value = object[name] else { return nil }
    guard let flag = value as? Bool else { throw InvalidRequest(message: "invalid \(name)") }
    return flag
}

private func alarm(_ fields: [String: Any]) throws -> AlarmChange {
    guard let value = fields["alarmMinutes"] else { return .keep }
    if value is NSNull { return .none }
    guard let minutes = value as? Int, minutes >= 0, minutes <= Limits.alarmMinutes else {
        throw InvalidRequest(message: "invalid alarmMinutes")
    }
    return .minutesBefore(minutes)
}
