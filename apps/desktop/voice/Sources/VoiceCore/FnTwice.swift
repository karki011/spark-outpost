import Foundation

public enum KeyEvent: String, Sendable {
    case fnTwice = "fn_twice"
    case keyDown = "key_down"
    case keyUp = "key_up"
}

public struct FnTwice {
    public static let window: Double = 0.4

    public var hold: Bool
    private var fnDown = false
    private var lastPress: Double?
    private var holding = false

    public init(hold: Bool) {
        self.hold = hold
    }

    public mutating func fn(down: Bool, at time: Double) -> KeyEvent? {
        guard down != fnDown else { return nil }
        fnDown = down
        if !down {
            guard holding else { return nil }
            holding = false
            return .keyUp
        }
        if let last = lastPress, time - last <= Self.window {
            lastPress = nil
            if hold {
                holding = true
                return .keyDown
            }
            return .fnTwice
        }
        lastPress = time
        return nil
    }

    public mutating func otherKey() {
        lastPress = nil
    }
}
