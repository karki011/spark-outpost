import AppKit
import ApplicationServices
import MacControlCore

struct RealSystemSource: SystemSource {
    static let openTimeout: DispatchTimeInterval = .seconds(10)

    func isTrusted() -> Bool {
        AXIsProcessTrusted()
    }

    func promptForTrust() -> Bool {
        promptForAccessibility()
    }

    func status() -> SessionStatus {
        sessionStatus()
    }

    func runningApps() -> [RunningApp] {
        let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
        return NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular && !$0.isTerminated }
            .map { app in
                RunningApp(
                    pid: app.processIdentifier,
                    name: app.localizedName,
                    bundleId: app.bundleIdentifier,
                    path: app.bundleURL?.path,
                    frontmost: app.processIdentifier == frontmost,
                    signature: codeSignature(pid: app.processIdentifier)
                )
            }
    }

    func isRunning(pid: Int32) -> Bool {
        guard let app = NSRunningApplication(processIdentifier: pid) else { return false }
        return !app.isTerminated
    }

    func open(bundleId: String) -> Int32? {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else { return nil }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        let finished = DispatchSemaphore(value: 0)
        let launched = LaunchedPid()
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, _ in
            launched.set(app?.processIdentifier)
            finished.signal()
        }
        guard finished.wait(timeout: .now() + Self.openTimeout) == .success else { return nil }
        return launched.get()
    }

    func postKey(_ key: KeyCode, toPid pid: Int32) {
        for isDown in [true, false] {
            CGEvent(keyboardEventSource: nil, virtualKey: key.rawValue, keyDown: isDown)?.postToPid(pid)
        }
    }
}

private final class LaunchedPid {
    private let lock = NSLock()
    private var pid: Int32?

    func set(_ value: Int32?) {
        lock.lock()
        pid = value
        lock.unlock()
    }

    func get() -> Int32? {
        lock.lock()
        defer { lock.unlock() }
        return pid
    }
}
