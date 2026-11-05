import ApplicationServices
import Foundation
import MacControlCore

struct AXHandle: Hashable {
    let element: AXUIElement

    static func == (left: AXHandle, right: AXHandle) -> Bool {
        CFEqual(left.element, right.element)
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(CFHash(element))
    }
}

struct RealAXSource: AXSource {
    static let messagingTimeout: Float = 1.0

    func application(pid: Int32) -> AXHandle {
        let element = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(element, Self.messagingTimeout)
        return AXHandle(element: element)
    }

    func text(_ attribute: TextAttribute, of element: AXHandle) -> String? {
        copy(name(of: attribute), of: element) as? String
    }

    func valueText(of element: AXHandle) -> String? {
        guard let value = copy(kAXValueAttribute, of: element) else { return nil }
        let typeId = CFGetTypeID(value)
        if typeId == CFStringGetTypeID() { return value as? String }
        if typeId == CFBooleanGetTypeID() { return CFBooleanGetValue((value as! CFBoolean)) ? "true" : "false" }
        if typeId == CFNumberGetTypeID() { return (value as? NSNumber)?.stringValue }
        return nil
    }

    func flag(_ attribute: FlagAttribute, of element: AXHandle) -> Bool? {
        let name = attribute == .enabled ? kAXEnabledAttribute : kAXFocusedAttribute
        return copy(name, of: element) as? Bool
    }

    func element(_ attribute: ElementAttribute, of element: AXHandle) -> AXHandle? {
        guard let value = copy(name(of: attribute), of: element),
              CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return AXHandle(element: value as! AXUIElement)
    }

    func elements(_ attribute: ListAttribute, of element: AXHandle) -> [AXHandle] {
        let name = attribute == .children ? kAXChildrenAttribute : kAXWindowsAttribute
        guard let values = copy(name, of: element) as? [AnyObject] else { return [] }
        return values.compactMap { value in
            guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
            return AXHandle(element: value as! AXUIElement)
        }
    }

    func actionNames(of element: AXHandle) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element.element, &names) == .success else { return [] }
        return (names as? [String]) ?? []
    }

    func isAlive(_ element: AXHandle) -> Bool {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element.element, kAXRoleAttribute as CFString, &value) != .invalidUIElement
    }

    func numberValue(of element: AXHandle) -> Double? {
        (copy(kAXValueAttribute, of: element) as? NSNumber)?.doubleValue
    }

    func perform(_ action: String, on element: AXHandle) throws {
        let result = AXUIElementPerformAction(element.element, action as CFString)
        guard result == .success else {
            throw AXFailure("\(action) failed (AX error \(result.rawValue))")
        }
    }

    func setNumberValue(_ value: Double, of element: AXHandle) throws {
        let result = AXUIElementSetAttributeValue(element.element, kAXValueAttribute as CFString, NSNumber(value: value))
        guard result == .success else {
            throw AXFailure("setting the scroll position failed (AX error \(result.rawValue))")
        }
    }

    private func copy(_ attribute: String, of element: AXHandle) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element.element, attribute as CFString, &value) == .success else {
            return nil
        }
        return value
    }

    private func name(of attribute: TextAttribute) -> String {
        switch attribute {
        case .role: return kAXRoleAttribute
        case .subrole: return kAXSubroleAttribute
        case .title: return kAXTitleAttribute
        case .description: return kAXDescriptionAttribute
        case .identifier: return kAXIdentifierAttribute
        }
    }

    private func name(of attribute: ElementAttribute) -> String {
        switch attribute {
        case .parent: return kAXParentAttribute
        case .mainWindow: return kAXMainWindowAttribute
        case .focusedWindow: return kAXFocusedWindowAttribute
        case .menuBar: return kAXMenuBarAttribute
        case .focusedElement: return kAXFocusedUIElementAttribute
        case .verticalScrollBar: return kAXVerticalScrollBarAttribute
        case .horizontalScrollBar: return kAXHorizontalScrollBarAttribute
        }
    }
}
