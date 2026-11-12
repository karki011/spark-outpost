// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "spark-voice",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "spark-voice", targets: ["spark-voice"])
    ],
    targets: [
        .target(name: "VoiceCore"),
        .systemLibrary(name: "CTranscribe", path: "Sources/CTranscribe"),
        .executableTarget(
            name: "spark-voice", dependencies: ["VoiceCore", "CTranscribe"],
            linkerSettings: [.unsafeFlags(["-Xlinker", "-weak_framework", "-Xlinker", "CoreAudio"])]),
        .testTarget(name: "VoiceCoreTests", dependencies: ["VoiceCore"]),
    ]
)
