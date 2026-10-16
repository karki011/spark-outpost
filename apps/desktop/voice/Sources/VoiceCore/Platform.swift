import CryptoKit
import Foundation

public protocol SpeechModel: AnyObject {
    func resetDetector()
    func probability(_ frame: [Float]) -> Float
    func transcribe(
        _ samples: [Float], language: String, hint: String, single: Bool,
        done: @escaping (String) -> Void
    )
}

public protocol Platform: AnyObject {
    var fileInputAllowed: Bool { get }
    func status() -> HelperStatus
    func loadModel(path: String, vad: String) -> SpeechModel?
    func startInput(
        file: String?, onFrames: @escaping ([Float]) -> Void, onEnd: @escaping () -> Void
    ) -> ErrorCode?
    func stopInput()
    func speak(text: String, voice: String?, done: @escaping (Bool) -> Void)
    func hush()
    func watchKeys(fn: Bool, hold: Bool, onKey: @escaping (KeyEvent) -> Void) -> Bool
}

public func sha256(ofFile path: String) -> String? {
    guard let handle = FileHandle(forReadingAtPath: path) else { return nil }
    defer { try? handle.close() }
    var hasher = SHA256()
    while true {
        let chunk = handle.readData(ofLength: 1 << 20)
        if chunk.isEmpty { break }
        hasher.update(data: chunk)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

public func cleanTranscript(_ text: String) -> String {
    let withoutTags = text.replacingOccurrences(
        of: #"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*"#, with: " ", options: .regularExpression)
    return withoutTags
        .split(whereSeparator: { $0.isWhitespace })
        .joined(separator: " ")
}
