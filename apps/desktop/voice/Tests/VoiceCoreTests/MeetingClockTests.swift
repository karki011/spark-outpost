import Foundation
import Testing
@testable import VoiceCore

private let start = #"{"id":"m","op":"meeting.start","language":"en"}"#
private let stop = #"{"id":"m","op":"meeting.stop"}"#

private func sources(_ scene: Scene) -> [MeetingSource] {
    scene.events.compactMap { event -> MeetingSource? in
        if case .meetingLine(let source, _, _, _) = event { return source }
        return nil
    }
}

@Suite struct MeetingClockTests {
    @Test func aLaneThatStartsLateIsTimedFromTheRecordingStart() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.platform.model.lines = ["Let's ship it on Friday.", "lets ship it on friday"]
        scene.play(frames(seconds: 5, speech: false))
        scene.now = 5
        scene.playOthers(frames(seconds: 2, speech: true))
        scene.playOthers(frames(seconds: 1, speech: false))
        scene.play(frames(seconds: 2, speech: true))
        scene.play(frames(seconds: 1, speech: false))
        #expect(sources(scene) == [.others])
        guard case .meetingLine(_, _, let othersStart, _) = scene.events[1] else {
            Issue.record("expected a meeting line")
            return
        }
        #expect(othersStart >= 4_700 && othersStart <= 5_000)
    }

    @Test func stoppingReleasesALineParkedBehindACutOthersTurn() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.platform.model.lines = ["a long turn from the others", "my own point entirely"]
        scene.playOthers(frames(seconds: 15, speech: true))
        scene.play(frames(seconds: 13, speech: false))
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 1, speech: false))
        #expect(sources(scene) == [.others])
        scene.send(stop)
        #expect(sources(scene) == [.others, .you])
        #expect(scene.events.last == .meetingEnded)
    }
}
