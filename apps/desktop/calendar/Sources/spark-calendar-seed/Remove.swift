import EventKit
import Foundation

func remove(store: EKEventStore, statePath: String) throws -> [String: Any] {
    let state = try readState(statePath)
    var removed = 0
    for id in Set(state.calendarIds) {
        guard let calendar = store.calendar(withIdentifier: id),
              calendar.source?.sourceIdentifier == state.sourceId,
              isSeededCalendar(calendar) else { continue }
        try store.removeCalendar(calendar, commit: false)
        removed += 1
    }
    if removed > 0 { try store.commit() }
    return ["ok": true, "removed": removed]
}

private func readState(_ path: String) throws -> SeedState {
    guard let data = FileManager.default.contents(atPath: path),
          let state = try? JSONDecoder().decode(SeedState.self, from: data) else {
        throw SeedFailure(message: "could not read the seed state file")
    }
    return state
}
