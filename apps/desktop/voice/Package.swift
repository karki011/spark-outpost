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
        .systemLibrary(name: "CWhisper", path: "Sources/CWhisper"),
        .executableTarget(name: "spark-voice", dependencies: ["VoiceCore", "CWhisper"]),
        .testTarget(name: "VoiceCoreTests", dependencies: ["VoiceCore"]),
    ]
)
