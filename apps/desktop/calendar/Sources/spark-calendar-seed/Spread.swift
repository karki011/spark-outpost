import EventKit
import Foundation

let spreadDays = 28

private struct DayEvent {
    let title: String
    let hour: Int
    let minute: Int
    let minutes: Int
    var family = false
    var notes: String?
    var url: String?
}

private let busyDay = [
    DayEvent(title: "Planning", hour: 9, minute: 0, minutes: 45, notes: "Sprint goals and owners."),
    DayEvent(title: "Hiring sync", hour: 10, minute: 0, minutes: 30, url: "https://meet.google.com/hir-sync-abc"),
    DayEvent(title: "Lunch with Priya", hour: 12, minute: 0, minutes: 60),
    DayEvent(title: "Customer demo", hour: 14, minute: 0, minutes: 60, notes: "Demo the month view. https://acme.zoom.us/j/555000111"),
    DayEvent(title: "Retro", hour: 16, minute: 0, minutes: 45, url: "https://meet.google.com/ret-roab-cde"),
]

private func eventsFor(offset: Int) -> [DayEvent] {
    if offset == 3 || offset == -4 { return busyDay }
    var events: [DayEvent] = []
    let slot = (offset % 7 + 7) % 7
    if slot == 0 || slot == 3 {
        events.append(DayEvent(title: "Design review", hour: 10, minute: 0, minutes: 60, notes: "Walk through the new calendar and agree next steps.", url: "https://meet.google.com/des-ignr-evw"))
    }
    if slot == 1 || slot == 4 {
        events.append(DayEvent(title: "1:1 with Sam", hour: 14, minute: 0, minutes: 30, notes: "Weekly catch-up https://acme.zoom.us/j/987654321"))
    }
    if slot == 2 || slot == 5 {
        events.append(DayEvent(title: "Focus: writing", hour: 13, minute: 0, minutes: 120))
    }
    if slot == 6 {
        events.append(DayEvent(title: "Dinner with family", hour: 18, minute: 30, minutes: 90, family: true))
    }
    if slot == 2 {
        events.append(DayEvent(title: "Gym", hour: 7, minute: 30, minutes: 60, family: true))
    }
    return events
}

private func date(_ day: Date, offset: Int, hour: Int, minute: Int) -> Date {
    let calendar = Calendar.current
    let shifted = calendar.date(byAdding: .day, value: offset, to: day) ?? day
    return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: shifted) ?? shifted
}

func saveSpread(test: EKCalendar, family: EKCalendar, now: Date, store: EKEventStore) throws {
    let today = Calendar.current.startOfDay(for: now)
    for offset in -spreadDays...spreadDays where offset != 0 {
        for seed in eventsFor(offset: offset) {
            let event = EKEvent(eventStore: store)
            event.title = seed.title
            event.calendar = seed.family ? family : test
            event.startDate = date(today, offset: offset, hour: seed.hour, minute: seed.minute)
            event.endDate = event.startDate.addingTimeInterval(TimeInterval(seed.minutes * 60))
            event.notes = seed.notes
            event.url = seed.url.flatMap(URL.init(string:))
            try store.save(event, span: .thisEvent, commit: false)
        }
    }
    let offsite = EKEvent(eventStore: store)
    offsite.title = "Team offsite"
    offsite.calendar = family
    offsite.isAllDay = true
    offsite.startDate = date(today, offset: -10, hour: 0, minute: 0)
    offsite.endDate = date(today, offset: -9, hour: 0, minute: 0)
    try store.save(offsite, span: .thisEvent, commit: false)
}
