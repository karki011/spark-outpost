public enum AXName {
    public static let window = "AXWindow"
    public static let sheet = "AXSheet"
    public static let menuBar = "AXMenuBar"
    public static let menu = "AXMenu"
    public static let scrollArea = "AXScrollArea"
    public static let secureTextField = "AXSecureTextField"
    public static let dialog = "AXDialog"
    public static let systemDialog = "AXSystemDialog"
    public static let unknownRole = "AXUnknown"
    public static let press = "AXPress"
    public static let confirm = "AXConfirm"
    public static let pick = "AXPick"
}

public enum TextAttribute: CaseIterable {
    case role, subrole, title, description, identifier
}

public enum FlagAttribute {
    case enabled, focused
}

public enum ElementAttribute {
    case parent, mainWindow, focusedWindow, menuBar, focusedElement
    case verticalScrollBar, horizontalScrollBar
}

public enum ListAttribute {
    case children, windows
}

public struct AXFailure: Error, Equatable {
    public var message: String

    public init(_ message: String) {
        self.message = message
    }
}

public protocol AXSource {
    associatedtype Element: Hashable

    func application(pid: Int32) -> Element
    func text(_ attribute: TextAttribute, of element: Element) -> String?
    func valueText(of element: Element) -> String?
    func flag(_ attribute: FlagAttribute, of element: Element) -> Bool?
    func element(_ attribute: ElementAttribute, of element: Element) -> Element?
    func elements(_ attribute: ListAttribute, of element: Element) -> [Element]
    func actionNames(of element: Element) -> [String]
    func isAlive(_ element: Element) -> Bool
    func numberValue(of element: Element) -> Double?
    func perform(_ action: String, on element: Element) throws
    func setNumberValue(_ value: Double, of element: Element) throws
}

public enum KeyCode: UInt16 {
    case returnKey = 36
    case enterKey = 76
}

public protocol SystemSource {
    func isTrusted() -> Bool
    func promptForTrust() -> Bool
    func status() -> SessionStatus
    func runningApps() -> [RunningApp]
    func isRunning(pid: Int32) -> Bool
    func open(bundleId: String) -> Int32?
    func postKey(_ key: KeyCode, toPid pid: Int32)
}
