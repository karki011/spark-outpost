import ApplicationServices
import Foundation
import MacControlCore

AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), RealAXSource.messagingTimeout)

let engine = Engine(system: RealSystemSource(), source: RealAXSource())

func writeLine(_ line: String) {
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

let reader = Thread {
    while let line = readLine(strippingNewline: true) {
        if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
        let response = DispatchQueue.main.sync { responseLine(for: line, engine: engine) }
        if let response { writeLine(response) }
    }
    exit(0)
}
reader.start()

RunLoop.main.add(Port(), forMode: .default)
while true {
    RunLoop.main.run(mode: .default, before: .distantFuture)
}
