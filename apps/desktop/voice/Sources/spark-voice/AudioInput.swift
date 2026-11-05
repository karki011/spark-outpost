import AVFoundation
import Foundation
import VoiceCore

private let target = AVAudioFormat(
    commonFormat: .pcmFormatFloat32, sampleRate: Double(ListenRules.sampleRate), channels: 1,
    interleaved: false)!

private func samples(of buffer: AVAudioPCMBuffer) -> [Float] {
    guard let channel = buffer.floatChannelData?[0] else { return [] }
    return Array(UnsafeBufferPointer(start: channel, count: Int(buffer.frameLength)))
}

private func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter) -> [Float] {
    let ratio = target.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
    guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return [] }
    var given = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
        if given {
            status.pointee = .noDataNow
            return nil
        }
        given = true
        status.pointee = .haveData
        return buffer
    }
    return error == nil ? samples(of: output) : []
}

final class Microphone {
    private var engine: AVAudioEngine?

    static func permission() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "not_determined"
        @unknown default: return "denied"
        }
    }

    func start(queue: DispatchQueue, onFrames: @escaping ([Float]) -> Void) -> ErrorCode? {
        guard Self.permission() == "granted" else { return .micDenied }
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0,
              let converter = AVAudioConverter(from: format, to: target)
        else { return .noInputDevice }
        input.installTap(onBus: 0, bufferSize: 4_096, format: format) { buffer, _ in
            let converted = convert(buffer, with: converter)
            if !converted.isEmpty { queue.async { onFrames(converted) } }
        }
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            return .noInputDevice
        }
        self.engine = engine
        return nil
    }

    func stop() {
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
    }
}

final class FileInput {
    private var playing = 0

    func play(
        path: String, queue: DispatchQueue, onFrames: @escaping ([Float]) -> Void,
        onEnd: @escaping () -> Void
    ) -> ErrorCode? {
        guard let file = try? AVAudioFile(forReading: URL(fileURLWithPath: path)),
              let converter = AVAudioConverter(from: file.processingFormat, to: target)
        else { return .failed }
        playing += 1
        let token = playing
        let chunk = AVAudioFrameCount(file.processingFormat.sampleRate / 10)
        let start = DispatchTime.now()
        var sent = 0
        func next() {
            guard playing == token else { return }
            guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk),
                  (try? file.read(into: buffer, frameCount: chunk)) != nil, buffer.frameLength > 0
            else {
                onEnd()
                return
            }
            converter.reset()
            onFrames(convert(buffer, with: converter))
            guard buffer.frameLength == chunk else {
                if playing == token { onEnd() }
                return
            }
            sent += 1
            queue.asyncAfter(deadline: start + .milliseconds(100 * sent)) { next() }
        }
        queue.async { next() }
        return nil
    }

    func stop() {
        playing += 1
    }
}
