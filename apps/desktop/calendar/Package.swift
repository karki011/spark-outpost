// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "spark-calendar",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "spark-calendar", targets: ["spark-calendar"]),
        .executable(name: "spark-calendar-seed", targets: ["spark-calendar-seed"]),
    ],
    targets: [
        .target(name: "CalendarCore"),
        .executableTarget(name: "spark-calendar", dependencies: ["CalendarCore"]),
        .executableTarget(name: "spark-calendar-seed"),
        .testTarget(name: "CalendarCoreTests", dependencies: ["CalendarCore"]),
    ]
)
