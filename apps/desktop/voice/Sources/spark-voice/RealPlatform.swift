import Foundation
import VoiceCore

func fnSetting() -> String {
    let usage = CFPreferencesCopyAppValue("AppleFnUsageType" as CFString, "com.apple.HIToolbox" as CFString) as? Int
    let dictation = CFPreferencesCopyAppValue("Dictation Enabled" as CFString, "com.apple.assistant.support" as CFString) as? Bool ?? false
    switch usage {
    case 0: return dictation ? "dictation" : "free"
    case 1: return "input_source"
    case 3: return "dictation"
    default: return "emoji"
    }
}

func currentArch() -> String {
    #if arch(arm64)
    return "arm64"
    #else
    return "x64"
    #endif
}

final class RealPlatform: Platform {
    let fileInputAllowed: Bool
    private let queue: DispatchQueue
    private let microphone = Microphone()
    private let fileInput = FileInput()
    private let keys = KeyMonitor()
    private var speaker: Speaker?
    private var language = "en"

    init(queue: DispatchQueue, fileInputAllowed: Bool) {
        self.queue = queue
        self.fileInputAllowed = fileInputAllowed
    }

    func status() -> HelperStatus {
        HelperStatus(
            mic: Microphone.permission(), inputMonitoring: KeyMonitor.allowed(), model: false,
            fnSetting: fnSetting(), arch: currentArch())
    }

    func loadModel(path: String, vad: String) -> SpeechModel? {
        WhisperModel(path: path, vad: vad, reply: queue)
    }

    func startInput(
        file: String?, onFrames: @escaping ([Float]) -> Void, onEnd: @escaping () -> Void
    ) -> ErrorCode? {
        if let file { return fileInput.play(path: file, onFrames: onFrames, onEnd: onEnd) }
        return microphone.start(queue: queue, onFrames: onFrames)
    }

    func stopInput() {
        fileInput.stop()
        microphone.stop()
    }

    func speak(text: String, voice: String?, done: @escaping (Bool) -> Void) {
        let queue = self.queue
        DispatchQueue.main.async { [self] in
            let speaker = self.speaker ?? Speaker()
            self.speaker = speaker
            speaker.speak(text: text, voice: voice, language: nil) { interrupted in
                queue.async { done(interrupted) }
            }
        }
    }

    func hush() {
        DispatchQueue.main.async { [self] in speaker?.hush() }
    }

    func watchKeys(fn: Bool, hold: Bool, onKey: @escaping (KeyEvent) -> Void) -> Bool {
        let queue = self.queue
        return DispatchQueue.main.sync {
            guard fn else {
                keys.stop()
                return true
            }
            return keys.watch(hold: hold) { key in queue.async { onKey(key) } }
        }
    }
}
