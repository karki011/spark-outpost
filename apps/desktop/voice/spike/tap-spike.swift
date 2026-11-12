import AudioToolbox
import AVFoundation
import CoreAudio
import Foundation

func check(_ status: OSStatus, _ what: String) {
    guard status != noErr else { return }
    print("FAILED \(what): OSStatus \(status)")
    exit(1)
}

func defaultOutputUID() -> String {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var device = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    check(
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device),
        "default output device")
    address.mSelector = kAudioDevicePropertyDeviceUID
    var uid: CFString = "" as CFString
    size = UInt32(MemoryLayout<CFString>.size)
    check(
        withUnsafeMutablePointer(to: &uid) {
            AudioObjectGetPropertyData(device, &address, 0, nil, &size, $0)
        }, "output device UID")
    return uid as String
}

@available(macOS 14.2, *)
func run(seconds: Double) {
    let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
    description.uuid = UUID()
    description.muteBehavior = .unmuted
    description.isPrivate = true
    var tap = AudioObjectID(kAudioObjectUnknown)
    check(AudioHardwareCreateProcessTap(description, &tap), "create process tap")
    print("tap created: \(tap)")

    var formatAddress = AudioObjectPropertyAddress(
        mSelector: kAudioTapPropertyFormat,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var format = AudioStreamBasicDescription()
    var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    check(AudioObjectGetPropertyData(tap, &formatAddress, 0, nil, &formatSize, &format), "tap format")
    print("tap format: \(format.mSampleRate) Hz, \(format.mChannelsPerFrame) channels, flags \(format.mFormatFlags)")

    let output = defaultOutputUID()
    let aggregate: [String: Any] = [
        kAudioAggregateDeviceNameKey: "Spark tap spike",
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
    var device = AudioObjectID(kAudioObjectUnknown)
    check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device), "create aggregate device")
    print("aggregate device: \(device)")

    let queue = DispatchQueue(label: "tap-spike")
    var peak: Float = 0
    var frames = 0
    var procID: AudioDeviceIOProcID?
    check(
        AudioDeviceCreateIOProcIDWithBlock(&procID, device, queue) { _, input, _, _, _ in
            let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
            for buffer in buffers {
                guard let data = buffer.mData else { continue }
                let count = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
                let samples = UnsafeBufferPointer(start: data.assumingMemoryBound(to: Float.self), count: count)
                frames += count
                for sample in samples { peak = max(peak, abs(sample)) }
            }
        }, "create IO proc")
    check(AudioDeviceStart(device, procID), "start device")
    print("capturing for \(seconds) s; play some audio now")

    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
        Thread.sleep(forTimeInterval: 1)
        queue.sync {
            print("samples \(frames), peak \(String(format: "%.3f", peak))")
            peak = 0
        }
    }

    check(AudioDeviceStop(device, procID), "stop device")
    if let procID { AudioDeviceDestroyIOProcID(device, procID) }
    check(AudioHardwareDestroyAggregateDevice(device), "destroy aggregate device")
    check(AudioHardwareDestroyProcessTap(tap), "destroy tap")
    print("done")
}

if #available(macOS 14.2, *) {
    run(seconds: 12)
} else {
    print("needs macOS 14.2")
}
