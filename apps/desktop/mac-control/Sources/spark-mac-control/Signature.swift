import Foundation
import MacControlCore
import Security

func codeSignature(pid: Int32) -> Signature {
    guard let code = guestCode(pid: pid) else {
        return Signature(valid: false, apple: false, teamId: nil)
    }
    return Signature(
        valid: SecCodeCheckValidity(code, [], nil) == errSecSuccess,
        apple: satisfiesAppleAnchor(code),
        teamId: teamIdentifier(code)
    )
}

private func guestCode(pid: Int32) -> SecCode? {
    let attributes = [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary
    var code: SecCode?
    guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess else { return nil }
    return code
}

private func satisfiesAppleAnchor(_ code: SecCode) -> Bool {
    var requirement: SecRequirement?
    guard SecRequirementCreateWithString("anchor apple" as CFString, [], &requirement) == errSecSuccess,
          let requirement else { return false }
    return SecCodeCheckValidity(code, [], requirement) == errSecSuccess
}

private func teamIdentifier(_ code: SecCode) -> String? {
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
    var information: CFDictionary?
    let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
    guard SecCodeCopySigningInformation(staticCode, flags, &information) == errSecSuccess,
          let details = information as? [String: Any] else { return nil }
    return details[kSecCodeInfoTeamIdentifier as String] as? String
}
