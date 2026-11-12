import AudioToolbox
import AVFoundation
import CoreAudio
import Foundation
import VoiceCore

private protocol TapHandle: AnyObject {
    func stop()
}

final class SystemAudio {
    private let work = DispatchQueue(label: "spark-voice.system-audio")
    private var session = 0
    private var active: TapHandle?

    static var supported: Bool {
        if #available(macOS 14.2, *) { return true }
        return false
    }

    func start(
        queue: DispatchQueue, onFrames: @escaping ([Float]) -> Void, onState: @escaping (Bool) -> Void
    ) {
        session += 1
        let token = session
        guard #available(macOS 14.2, *) else {
            queue.async { onState(false) }
            return
        }
        work.async { [self] in
            let tap = ProcessTap()
            let started = tap.start { samples in queue.async { onFrames(samples) } }
            queue.async { [self] in
                guard session == token, started else {
                    work.async { tap.stop() }
                    if session == token { onState(false) }
                    return
                }
                active = tap
                onState(true)
            }
        }
    }

    func stop() {
        session += 1
        guard let tap = active else { return }
        active = nil
        work.async { tap.stop() }
    }
}

private func defaultOutputUID() -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var device = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr
    else { return nil }
    address.mSelector = kAudioDevicePropertyDeviceUID
    var uid: CFString = "" as CFString
    size = UInt32(MemoryLayout<CFString>.size)
    let status = withUnsafeMutablePointer(to: &uid) {
        AudioObjectGetPropertyData(device, &address, 0, nil, &size, $0)
    }
    return status == noErr ? uid as String : nil
}

@available(macOS 14.2, *)
private final class ProcessTap: TapHandle {
    private var tap = AudioObjectID(kAudioObjectUnknown)
    private var device = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let io = DispatchQueue(label: "spark-voice.system-audio.io")

    func start(onSamples: @escaping ([Float]) -> Void) -> Bool {
        let started = open(onSamples: onSamples)
        if !started { stop() }
        return started
    }

    private func open(onSamples: @escaping ([Float]) -> Void) -> Bool {
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.muteBehavior = .unmuted
        description.isPrivate = true
        guard AudioHardwareCreateProcessTap(description, &tap) == noErr else { return false }

        var formatAddress = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var format = AudioStreamBasicDescription()
        var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        guard AudioObjectGetPropertyData(tap, &formatAddress, 0, nil, &formatSize, &format) == noErr,
              let source = AVAudioFormat(streamDescription: &format),
              let converter = AVAudioConverter(from: source, to: target),
              let output = defaultOutputUID()
        else { return false }

        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Spark Outpost meeting audio",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: output,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: output]],
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapDriftCompensationKey: true,
                    kAudioSubTapUIDKey: description.uuid.uuidString,
                ]
            ],
        ]
        guard AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device) == noErr else {
            return false
        }
        let created = AudioDeviceCreateIOProcIDWithBlock(&procID, device, io) { _, input, _, _, _ in
            guard let buffer = AVAudioPCMBuffer(pcmFormat: source, bufferListNoCopy: input, deallocator: nil)
            else { return }
            let converted = convert(buffer, with: converter)
            if !converted.isEmpty { onSamples(converted) }
        }
        return created == noErr && AudioDeviceStart(device, procID) == noErr
    }

    func stop() {
        if let procID {
            _ = AudioDeviceStop(device, procID)
            _ = AudioDeviceDestroyIOProcID(device, procID)
        }
        procID = nil
        if device != kAudioObjectUnknown { _ = AudioHardwareDestroyAggregateDevice(device) }
        device = AudioObjectID(kAudioObjectUnknown)
        if tap != kAudioObjectUnknown { _ = AudioHardwareDestroyProcessTap(tap) }
        tap = AudioObjectID(kAudioObjectUnknown)
    }
}
