import CoreGraphics
import Foundation
import VoiceCore

final class KeyMonitor {
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var detector = FnTwice(hold: false)
    private var onKey: ((KeyEvent) -> Void)?

    static func allowed() -> Bool {
        CGPreflightListenEventAccess()
    }

    func watch(hold: Bool, onKey: @escaping (KeyEvent) -> Void) -> Bool {
        stop()
        guard Self.allowed() else { return false }
        detector = FnTwice(hold: hold)
        self.onKey = onKey
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let pointer = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: CGEventMask(mask),
            callback: { _, type, event, info in
                if let info {
                    Unmanaged<KeyMonitor>.fromOpaque(info).takeUnretainedValue().observe(type, event)
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: pointer)
        else { return false }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        self.tap = tap
        self.source = source
        return true
    }

    func stop() {
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        tap = nil
        source = nil
        onKey = nil
    }

    private func observe(_ type: CGEventType, _ event: CGEvent) {
        let now = ProcessInfo.processInfo.systemUptime
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        case .keyDown:
            detector.otherKey()
        case .flagsChanged:
            let fnKeyCode: Int64 = 63
            guard event.getIntegerValueField(.keyboardEventKeycode) == fnKeyCode else {
                detector.otherKey()
                return
            }
            let down = event.flags.contains(.maskSecondaryFn)
            if let key = detector.fn(down: down, at: now) { onKey?(key) }
        default:
            break
        }
    }
}
