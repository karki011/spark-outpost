import Foundation

public protocol Cancellable {
    func cancel()
}

public protocol Scheduler {
    func schedule(after seconds: TimeInterval, _ work: @escaping () -> Void) -> Cancellable
}

public final class Debouncer {
    public static let changedDelay: TimeInterval = 2

    private let scheduler: Scheduler
    private let delay: TimeInterval
    private let fire: () -> Void
    private var pending: Cancellable?

    public init(scheduler: Scheduler, delay: TimeInterval = Debouncer.changedDelay, fire: @escaping () -> Void) {
        self.scheduler = scheduler
        self.delay = delay
        self.fire = fire
    }

    public func signal() {
        pending?.cancel()
        pending = scheduler.schedule(after: delay) { [weak self] in
            self?.pending = nil
            self?.fire()
        }
    }
}
