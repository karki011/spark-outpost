import AVFoundation
import Foundation

final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var done: ((Bool) -> Void)?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(text: String, voice: String?, language: String?, done: @escaping (Bool) -> Void) {
        finish(interrupted: true)
        self.done = done
        let utterance = AVSpeechUtterance(string: text)
        if let voice, let chosen = AVSpeechSynthesisVoice(identifier: voice) {
            utterance.voice = chosen
        } else if let language {
            utterance.voice = AVSpeechSynthesisVoice(language: language)
        }
        synthesizer.speak(utterance)
    }

    func hush() {
        synthesizer.stopSpeaking(at: .immediate)
        finish(interrupted: true)
    }

    private func finish(interrupted: Bool) {
        let callback = done
        done = nil
        callback?(interrupted)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        finish(interrupted: false)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        finish(interrupted: true)
    }
}
