import Foundation
import VoiceCore

Transcriber.silenceLogs()

let output = NSLock()
func writeLine(_ line: String) {
    output.lock()
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
    output.unlock()
}

let engineQueue = DispatchQueue(label: "spark-voice.engine")
let platform = RealPlatform(
    queue: engineQueue, fileInputAllowed: CommandLine.arguments.contains("--allow-file-input"))
let engine = Engine(platform: platform) { id, message in writeLine(encode(id: id, message)) }

let reader = Thread {
    while let line = readLine(strippingNewline: true) {
        if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
        engineQueue.async { engine.handle(line: line) }
    }
    engineQueue.sync { platform.stopInput() }
    _exit(0)
}
reader.start()

RunLoop.main.add(Port(), forMode: .default)
while true {
    RunLoop.main.run(mode: .default, before: .distantFuture)
}
