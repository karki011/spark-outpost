import CalendarCore
import EventKit
import Foundation

final class MainScheduler: Scheduler {
    func schedule(after seconds: TimeInterval, _ work: @escaping () -> Void) -> Cancellable {
        let item = DispatchWorkItem(block: work)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
        return item
    }
}

extension DispatchWorkItem: Cancellable {}

func writeLine(_ line: String) {
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

let store = EventKitStore()
let engine = Engine(store: store)
let changes = Debouncer(scheduler: MainScheduler()) { writeLine(changedLine) }

let observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store.store, queue: .main) { _ in
    changes.signal()
}

let reader = Thread {
    while let line = readLine(strippingNewline: true) {
        if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
        DispatchQueue.main.async { respond(to: line, engine: engine, write: writeLine) }
    }
    DispatchQueue.main.async { exit(0) }
}
reader.start()

RunLoop.main.add(Port(), forMode: .default)
while true {
    RunLoop.main.run(mode: .default, before: .distantFuture)
}
