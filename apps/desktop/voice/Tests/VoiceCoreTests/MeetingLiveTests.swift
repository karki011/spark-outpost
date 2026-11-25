import Foundation
import Testing
@testable import VoiceCore

private let start = #"{"id":"m","op":"meeting.start","language":"en"}"#

@Suite struct MeetingLiveTests {
    @Test func wordsSoFarArriveWhileSomeoneIsStillSpeaking() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.playOthers(frames(seconds: 0.4, speech: true))
        #expect(scene.partials.isEmpty)
        scene.playOthers(frames(seconds: 0.4, speech: true))
        #expect(scene.partials == [.meetingPartial(source: .others, text: "draft1", startMs: 0)])
        scene.playOthers(frames(seconds: 0.5, speech: true))
        #expect(scene.partials.count == 2)
        #expect(scene.platform.model.transcribed.isEmpty)
    }

    @Test func theSameWordsAreNotSentTwice() {
        let scene = Scene().loaded()
        scene.platform.model.draftText = "hello there"
        scene.send(start)
        scene.playOthers(frames(seconds: 3, speech: true))
        #expect(scene.partials == [.meetingPartial(source: .others, text: "hello there", startMs: 0)])
    }

    @Test func aDraftCarriesTheStartOfItsSentence() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.playOthers(frames(seconds: 2, speech: false))
        scene.playOthers(frames(seconds: 1, speech: true))
        guard case .meetingPartial(_, _, let draftStart) = scene.partials.first else {
            Issue.record("expected words so far")
            return
        }
        scene.playOthers(frames(seconds: 1, speech: false))
        guard case .meetingLine(_, _, let lineStart, _) = scene.events.last else {
            Issue.record("expected the stored line")
            return
        }
        #expect(draftStart == lineStart)
    }

    @Test func aDraftThatReturnsAfterItsSentenceClosedIsDropped() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(start)
        scene.playOthers(frames(seconds: 1, speech: true))
        scene.playOthers(frames(seconds: 1, speech: false))
        for done in scene.platform.model.deferred { done() }
        #expect(scene.partials.isEmpty)
        #expect(scene.events.count == 2)
    }

    @Test func noDraftsAreStartedWhileAStoredLineIsBeingTranscribed() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(start)
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 1, speech: false))
        let drafted = scene.platform.model.drafted.count
        scene.playOthers(frames(seconds: 2, speech: true))
        #expect(scene.platform.model.drafted.count == drafted)
    }

    @Test func myMicrophoneShowsNoWordsWhileTheMacIsPlayingSpeech() {
        let scene = Scene().loaded()
        scene.send(start)
        scene.playOthers(frames(seconds: 1, speech: true))
        let before = scene.partials.count
        scene.play(frames(seconds: 2, speech: true))
        #expect(scene.partials.count == before)
    }

    @Test func myMicrophoneShowsNoWordsThatTheMacJustPlayed() {
        let scene = Scene().loaded()
        scene.platform.model.lines = ["we ship on monday"]
        scene.platform.model.draftText = "we ship on monday"
        scene.send(start)
        scene.playOthers(frames(seconds: 1, speech: true))
        scene.playOthers(frames(seconds: 1, speech: false))
        let before = scene.partials.count
        scene.play(frames(seconds: 1.5, speech: true))
        #expect(scene.partials.count == before)
    }

    @Test func myDraftIsDroppedWhenTheMacStartedPlayingSpeechWhileItWasDecoded() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(start)
        scene.play(frames(seconds: 1, speech: true))
        #expect(scene.platform.model.deferred.count == 1)
        scene.playOthers(frames(seconds: 0.3, speech: true))
        for done in scene.platform.model.deferred { done() }
        #expect(scene.partials.isEmpty)
    }

    @Test func stoppingSendsNoMoreWords() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(start)
        scene.playOthers(frames(seconds: 1, speech: true))
        scene.send(#"{"id":"m","op":"meeting.stop"}"#)
        for done in scene.platform.model.deferred { done() }
        #expect(scene.partials.isEmpty)
    }

    @Test func wordsSoFarAreEncodedForTheApp() {
        let line = encode(id: "m", .meetingPartial(source: .you, text: "hi", startMs: 1_200))
        #expect(line == #"{"event":"meeting_partial","id":"m","source":"you","startMs":1200,"text":"hi"}"#)
    }
}
