import Foundation
import Testing
@testable import VoiceCore

@Suite struct InterimTests {
    @Test func aCommandShowsTentativeTextWhileTheUserSpeaks() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"c","op":"listen","purpose":"command"}"#)
        scene.play(frames(seconds: 1.2, speech: true))
        #expect(scene.events == [.speech, .partial("draft1"), .partial("draft2")])
        #expect(scene.platform.model.drafted == [9_728, 17_920])
        scene.play(frames(seconds: 1.6, speech: false))
        #expect(scene.events.last == .final(text: "part1", reason: .paused))
        #expect(scene.platform.model.transcribed.count == 1)
    }

    @Test func aDictationShowsCommittedTextThenTheOpenSegmentsDraft() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"d","op":"listen","purpose":"dictation"}"#)
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 1, speech: false))
        scene.play(frames(seconds: 0.7, speech: true))
        #expect(scene.events.suffix(2) == [.partial("part1"), .partial("part1 draft2")])
        scene.send(#"{"id":"d","op":"stop"}"#)
        #expect(scene.events.last == .final(text: "part1 part2", reason: .stopped))
    }

    @Test func aShortUtteranceGetsNoDraft() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(#"{"id":"c","op":"listen","purpose":"command"}"#)
        scene.play(frames(seconds: 0.5, speech: true))
        scene.send(#"{"id":"c","op":"stop"}"#)
        #expect(scene.platform.model.drafted.isEmpty)
        scene.platform.model.deferred.forEach { $0() }
        #expect(scene.events == [.speech, .final(text: "part1", reason: .stopped)])
    }

    @Test func onlyOneDraftRunsAtATime() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(#"{"id":"d","op":"listen","purpose":"dictation"}"#)
        scene.play(frames(seconds: 3, speech: true))
        #expect(scene.platform.model.drafted.count == 1)
        scene.platform.model.deferred.removeFirst()()
        #expect(scene.events == [.speech, .partial("draft1")])
        scene.play(frames(seconds: 0.6, speech: true))
        #expect(scene.platform.model.drafted.count == 2)
        #expect(scene.platform.model.drafted[1] > scene.platform.model.drafted[0])
    }

    @Test func aDraftForASegmentThatHasClosedIsDropped() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(#"{"id":"d","op":"listen","purpose":"dictation"}"#)
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 1, speech: false))
        #expect(scene.platform.model.deferred.count == 2)
        scene.platform.model.deferred.forEach { $0() }
        #expect(scene.events == [.speech, .partial("part1")])
    }

    @Test func noDraftArrivesAfterTheFinal() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(#"{"id":"c","op":"listen","purpose":"command"}"#)
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 1.6, speech: false))
        scene.platform.model.deferred.forEach { $0() }
        #expect(scene.events == [.speech, .final(text: "part1", reason: .paused)])
    }

    @Test func noDraftStartsOnceTheListenHasEnded() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(#"{"id":"c","op":"listen","purpose":"command"}"#)
        scene.play(frames(seconds: 0.4, speech: true))
        scene.send(#"{"id":"c","op":"stop"}"#)
        scene.play(frames(seconds: 2, speech: true))
        #expect(scene.platform.model.drafted.isEmpty)
        scene.platform.model.deferred.forEach { $0() }
        #expect(scene.events == [.speech, .final(text: "part1", reason: .stopped)])
    }

    @Test func noDraftArrivesAfterACancel() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(#"{"id":"d","op":"listen","purpose":"dictation"}"#)
        scene.play(frames(seconds: 1, speech: true))
        scene.send(#"{"id":"d","op":"cancel"}"#)
        scene.platform.model.deferred.forEach { $0() }
        #expect(scene.events == [.speech, .cancelled])
    }

    @Test func aDraftThatRepeatsTheShownTextIsNotSentAgain() {
        let scene = Scene().loaded()
        scene.platform.model.draftText = "same"
        scene.send(#"{"id":"d","op":"listen","purpose":"dictation"}"#)
        scene.play(frames(seconds: 2, speech: true))
        #expect(scene.platform.model.drafted.count > 1)
        #expect(scene.events == [.speech, .partial("same")])
    }
}
