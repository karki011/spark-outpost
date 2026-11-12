# Audio tap spike

`tap-spike.swift` is a throwaway check, not part of the helper: it opens a CoreAudio process tap on the Mac's output for 12 seconds and prints the peak level each second. It answers whether meeting capture can hear a call's audio, which permission macOS asks for and which app it credits. Delete this folder once the helper's meeting mode is built.

Run it with `swiftc -O tap-spike.swift -o /tmp/tap-spike && /tmp/tap-spike` while something plays.
