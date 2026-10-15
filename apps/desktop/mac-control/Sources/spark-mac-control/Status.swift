import AppKit
import ApplicationServices
import Carbon
import MacControlCore

private let screenSaverBundleId = "com.apple.ScreenSaver.Engine"
private let onConsoleKey = "kCGSSessionOnConsoleKey"
private let screenLockedKey = "CGSSessionScreenIsLocked"

func sessionStatus() -> SessionStatus {
    SessionStatus(
        trusted: AXIsProcessTrusted(),
        locked: isScreenLocked(),
        secureInput: IsSecureEventInputEnabled(),
        idleSeconds: secondsSinceInput(),
        frontmostPid: NSWorkspace.shared.frontmostApplication?.processIdentifier
    )
}

func promptForAccessibility() -> Bool {
    let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    return AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary)
}

private func isScreenLocked() -> Bool {
    if let session = CGSessionCopyCurrentDictionary() as? [String: Any] {
        if let onConsole = session[onConsoleKey] as? Bool, !onConsole { return true }
        if let locked = session[screenLockedKey] as? Bool, locked { return true }
    }
    if NSWorkspace.shared.runningApplications.contains(where: { $0.bundleIdentifier == screenSaverBundleId }) {
        return true
    }
    return CGDisplayIsAsleep(CGMainDisplayID()) != 0
}

private func secondsSinceInput() -> Double {
    guard let anyInput = CGEventType(rawValue: ~0) else { return 0 }
    return CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: anyInput)
}
