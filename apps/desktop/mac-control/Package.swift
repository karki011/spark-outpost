// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "spark-mac-control",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "spark-mac-control", targets: ["spark-mac-control"])
    ],
    targets: [
        .target(name: "MacControlCore"),
        .executableTarget(name: "spark-mac-control", dependencies: ["MacControlCore"]),
        .testTarget(name: "MacControlCoreTests", dependencies: ["MacControlCore"]),
    ]
)
