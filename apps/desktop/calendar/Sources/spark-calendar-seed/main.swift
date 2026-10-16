import EventKit
import Foundation

struct SeedFailure: Error {
    let message: String
}

func printJSON(_ object: [String: Any]) {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
    FileHandle.standardOutput.write(data + Data("\n".utf8))
}

func hasFullAccess() -> Bool {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14, *) { return status == .fullAccess }
    return status == .authorized
}

func statePath(_ arguments: [String]) throws -> String {
    guard arguments.count == 4, arguments[2] == "--state", !arguments[3].isEmpty else {
        throw SeedFailure(message: "usage: spark-calendar-seed seed|remove --state <file>")
    }
    return arguments[3]
}

func run(_ arguments: [String]) throws -> [String: Any] {
    let path = try statePath(arguments)
    guard hasFullAccess() else {
        throw SeedFailure(message: "Calendars full access is not granted; grant it before seeding")
    }
    let store = EKEventStore()
    switch arguments[1] {
    case "seed": return try seed(store: store, statePath: path)
    case "remove": return try remove(store: store, statePath: path)
    default: throw SeedFailure(message: "usage: spark-calendar-seed seed|remove --state <file>")
    }
}

do {
    printJSON(try run(CommandLine.arguments))
} catch let failure as SeedFailure {
    printJSON(["ok": false, "message": failure.message])
    exit(1)
} catch {
    printJSON(["ok": false, "message": "the calendar store refused the change"])
    exit(1)
}
