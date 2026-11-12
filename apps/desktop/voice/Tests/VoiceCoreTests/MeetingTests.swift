import Foundation
import Testing
@testable import VoiceCore

private let start = #"{"id":"m","op":"meeting.start","language":"en"}"#
private let stop = #"{"id":"m","op":"meeting.stop"}"#

@Suite struct MeetingTests {
    @Test func aMeetingLabelsEachStreamAndTimesItsLines() {
        let scene = Scene().loaded()
        scene.send(start)
        #expect(scene.events == [.meetingStarted])
        #expect(scene.platform.model.detectorsMade == 2)
        scene.platform.onSystemState?(true)
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 1, speech: false))
        scene.playOthers(frames(seconds: 2, speech: false))
        scene.playOthers(frames(seconds: 1.5, speech: true))
        scene.playOthers(frames(seconds: 1, speech: false))
        #expect(scene.events.count == 4)
        #expect(scene.events[1] == .meetingSystem(true))
        guard case .meetingLine(let mine, let myText, let myStart, let myEnd) = scene.events[2],
              case .meetingLine(let theirs, let theirText, let theirStart, let theirEnd) = scene.events[3]
        else {
            Issue.record("expected two meeting lines")
            return
        }
        #expect(mine == .you)
        #expect(myText == "part1")
        #expect(myStart == 0)
        #expect(myEnd > 1_700 && myEnd < 2_000)
        #expect(theirs == .others)
        #expect(theirText == "part2")
        #expect(theirStart > 1_600 && theirStart <= 2_000)
        #expect(theirEnd > 4_100 && theirEnd < 4_500)
    }

    @Test func aMeetingRunsThroughLongSilenceWithoutEnding() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.play(frames(seconds: 120, speech: false))
        scene.playOthers(frames(seconds: 120, speech: false))
        #expect(scene.events == [.meetingStarted])
        #expect(scene.engine.isRecordingMeeting)
    }

    @Test func aLongTurnIsCutIntoSegments() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.play(frames(seconds: 31, speech: true))
        #expect(scene.platform.model.transcribed.count == 2)
        #expect(scene.events.count == 3)
    }

    @Test func aLongTurnIsCutAtABreathOnceItIsTenSecondsLong() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.play(frames(seconds: 11, speech: true))
        #expect(scene.platform.model.transcribed.isEmpty)
        scene.play(frames(seconds: 0.1, speech: false))
        #expect(scene.platform.model.transcribed.count == 1)
        scene.play(frames(seconds: 3, speech: true))
        scene.play(frames(seconds: 1, speech: false))
        #expect(scene.platform.model.transcribed.count == 2)
        guard case .meetingLine(_, _, _, let firstEnd) = scene.events[1],
              case .meetingLine(_, _, let secondStart, _) = scene.events[2]
        else {
            Issue.record("expected two meeting lines")
            return
        }
        #expect(firstEnd == secondStart)
        #expect(firstEnd > 10_900 && firstEnd < 11_300)
    }

    @Test func stoppingSendsTheOpenSentenceAndWaitsForItsText() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.platform.model.holdTranscripts = true
        scene.play(frames(seconds: 1, speech: true))
        scene.send(stop)
        #expect(scene.platform.inputStops == 1)
        #expect(scene.platform.systemStops == 1)
        #expect(scene.events == [.meetingStarted])
        scene.platform.model.deferred.forEach { $0() }
        #expect(scene.events.count == 3)
        #expect(scene.events.last == .meetingEnded)
        #expect(!scene.engine.isRecordingMeeting)
    }

    @Test func audioAfterStopIsIgnored() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.send(stop)
        scene.play(frames(seconds: 2, speech: true))
        scene.play(frames(seconds: 1, speech: false))
        #expect(scene.events == [.meetingStarted, .meetingEnded])
    }

    @Test func pushToTalkIsRefusedWhileAMeetingRecords() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.send(#"{"id":"a","op":"listen","purpose":"command"}"#)
        #expect(scene.events.last == .error(.busy, "recording a meeting"))
        scene.send(#"{"id":"s","op":"speak","text":"hello"}"#)
        #expect(scene.events.last == .error(.busy, "listening"))
        #expect(scene.engine.isRecordingMeeting)
    }

    @Test func aMeetingIsRefusedWhileListeningAndWhileAnotherRecords() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"a","op":"listen","purpose":"dictation"}"#)
        scene.send(start)
        #expect(scene.events.last == .error(.busy, "listening"))
        scene.send(#"{"id":"a","op":"cancel"}"#)
        scene.send(start)
        scene.send(#"{"id":"n","op":"meeting.start"}"#)
        #expect(scene.events.last == .error(.busy, "already recording a meeting"))
    }

    @Test func aMicrophoneThatCannotStartEndsTheStart() {
        let scene = Scene().loaded()
        scene.platform.startFailure = .micDenied
        scene.send(start)
        #expect(scene.events == [.error(.micDenied, "the microphone could not start")])
        #expect(!scene.engine.isRecordingMeeting)
    }

    @Test func aMeetingNeedsAModelAndFileInputNeedsItsSwitch() {
        let unloaded = Scene()
        unloaded.send(start)
        #expect(unloaded.events == [.error(.modelMissing, "load a model first")])
        let scene = Scene().loaded()
        scene.send(#"{"id":"m","op":"meeting.start","file":"/tmp/a.wav"}"#)
        #expect(scene.events == [.error(.fileInputOff, "file input is for tests")])
    }

    @Test func systemAudioThatCannotStartIsReportedAndTheMicrophoneCarriesOn() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.platform.onSystemState?(false)
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 1, speech: false))
        #expect(scene.events.count == 3)
        #expect(scene.events[1] == .meetingSystem(false))
    }

    @Test func meetingMessagesEncodeForTheHost() {
        let line = encode(id: "m", .meetingLine(source: .others, text: "hello", startMs: 10, endMs: 900))
        #expect(line == #"{"endMs":900,"event":"meeting_line","id":"m","source":"others","startMs":10,"text":"hello"}"#)
        #expect(encode(id: "m", .meetingSystem(true)) == #"{"event":"meeting_system","id":"m","on":true}"#)
        #expect(encode(id: "m", .meetingStarted) == #"{"event":"meeting_started","id":"m"}"#)
        #expect(encode(id: "m", .meetingEnded) == #"{"event":"meeting_ended","id":"m"}"#)
    }
}
