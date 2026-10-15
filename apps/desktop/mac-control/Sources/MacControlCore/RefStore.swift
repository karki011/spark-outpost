public struct Placement<Element: Hashable>: Equatable {
    public var window: Element?
    public var sheet: Element?
    public var ancestors: [String]

    public static var top: Placement { Placement(window: nil, sheet: nil, ancestors: []) }

    func placing(_ element: Element, role: String) -> Placement {
        var placed = self
        if role == AXName.window { placed.window = element }
        if role == AXName.sheet { placed.sheet = element }
        return placed
    }

    func lineageForChildren(title: String?) -> Placement {
        guard let title else { return self }
        var lineage = self
        lineage.ancestors = Array(([title] + ancestors).prefix(Limits.ancestors))
        return lineage
    }
}

public struct RefRecord<Element: Hashable> {
    public var element: Element
    public var pid: Int32
    public var identity: Identity
    public var placement: Placement<Element>
}

public final class RefStore<Element: Hashable> {
    private var nextNumber = 1
    private var numbersByElement: [Element: Int] = [:]
    private var records: [Int: RefRecord<Element>] = [:]

    public init() {}

    public func ref(for record: RefRecord<Element>) -> String {
        if let number = numbersByElement[record.element] {
            records[number] = record
            return Self.name(number)
        }
        let number = nextNumber
        nextNumber += 1
        numbersByElement[record.element] = number
        records[number] = record
        return Self.name(number)
    }

    public func record(_ ref: String) -> RefRecord<Element>? {
        guard let number = Self.number(ref) else { return nil }
        return records[number]
    }

    public func rebind(_ ref: String, to record: RefRecord<Element>) {
        guard let number = Self.number(ref), let old = records[number] else { return }
        if numbersByElement[old.element] == number {
            numbersByElement[old.element] = nil
        }
        numbersByElement[record.element] = number
        records[number] = record
    }

    static func name(_ number: Int) -> String {
        "ax_\(number)"
    }

    static func number(_ ref: String) -> Int? {
        guard isValidRef(ref) else { return nil }
        return Int(ref.dropFirst(3))
    }
}

func isValidRef(_ ref: String) -> Bool {
    guard ref.hasPrefix("ax_") else { return false }
    let digits = ref.dropFirst(3)
    guard let first = digits.first, first != "0", digits.count <= 9 else { return false }
    return digits.allSatisfy { $0.isASCII && $0.isNumber }
}
