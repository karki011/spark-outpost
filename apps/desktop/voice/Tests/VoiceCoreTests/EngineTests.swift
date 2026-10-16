import Foundation
import Testing
@testable import VoiceCore

@Suite struct EngineTests {
    @Test func aCommandEndsAfterAPauseOfSilence() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"a","op":"listen","purpose":"command","language":"en"}"#)
        scene.play(frames(seconds: 0.5, speech: false))
        scene.play(frames(seconds: 1.2, speech: true))
        scene.play(frames(seconds: 1.0, speech: false))
        #expect(scene.events == [.speech])
        scene.play(frames(seconds: 0.6, speech: false))
        #expect(scene.events == [.speech, .final(text: "part1", reason: .paused)])
        #expect(scene.platform.inputStops == 1)
        #expect(!scene.engine.isListening)
    }

    @Test func aDictationRunsThroughPausesUntilStopped() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"d","op":"listen","purpose":"dictation"}"#)
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 2, speech: false))
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 2, speech: false))
        scene.play(frames(seconds: 0.5, speech: true))
        #expect(scene.events == [.speech, .partial("part1"), .partial("part1 part2")])
        scene.send(#"{"id":"d","op":"stop"}"#)
        #expect(scene.events.last == .final(text: "part1 part2 part3", reason: .stopped))
    }

    @Test func thirtySecondsWithNoSpeechStopsADictation() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"q","op":"listen","purpose":"dictation"}"#)
        scene.play(frames(seconds: 29.5, speech: false))
        #expect(scene.events.isEmpty)
        scene.play(frames(seconds: 1, speech: false))
        #expect(scene.events == [.final(text: "", reason: .silence)])
    }

    @Test func threeSecondsWithNoSpeechStopsACommand() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"c","op":"listen","purpose":"command"}"#)
        scene.play(frames(seconds: 2.9, speech: false))
        #expect(scene.events.isEmpty)
        scene.play(frames(seconds: 0.2, speech: false))
        #expect(scene.events == [.final(text: "", reason: .silence)])
        #expect(!scene.engine.isListening)
    }

    @Test func threeSecondsWithNoSpeechStopsAConfirm() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"y","op":"listen","purpose":"confirm"}"#)
        scene.play(frames(seconds: 3.1, speech: false))
        #expect(scene.events == [.final(text: "", reason: .silence)])
    }

    @Test func aCommandSpokenAfterTwoSilentSecondsStillEndsOnItsPause() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"c","op":"listen","purpose":"command"}"#)
        scene.play(frames(seconds: 2.5, speech: false))
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 1.4, speech: false))
        #expect(scene.events == [.speech])
        scene.play(frames(seconds: 0.2, speech: false))
        #expect(scene.events == [.speech, .final(text: "part1", reason: .paused)])
    }

    @Test func thirtySecondsAfterTheLastSpeechStopsADictation() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"q","op":"listen","purpose":"dictation"}"#)
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 31, speech: false))
        #expect(scene.events.last == .final(text: "part1", reason: .silence))
    }

    @Test func longSpeechIsCutIntoSegmentsSoMemoryStaysBounded() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"c","op":"listen","purpose":"command"}"#)
        scene.play(frames(seconds: 65, speech: true))
        scene.send(#"{"id":"c","op":"stop"}"#)
        let limit = 30 * ListenRules.sampleRate
        #expect(scene.platform.model.transcribed.count == 3)
        #expect(scene.platform.model.transcribed.allSatisfy { $0 <= limit + ListenRules.frameSamples })
    }

    @Test func cancelDropsAudioAndTextAndLateTranscripts() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(#"{"id":"c","op":"listen","purpose":"command"}"#)
        scene.play(frames(seconds: 1, speech: true))
        scene.play(frames(seconds: 1.6, speech: false))
        scene.send(#"{"id":"c","op":"cancel"}"#)
        scene.platform.model.deferred.forEach { $0() }
        #expect(scene.events == [.speech, .cancelled])
    }

    @Test func stopAndCancelForAnotherListenAreIgnored() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"c","op":"listen","purpose":"command"}"#)
        scene.send(#"{"id":"other","op":"cancel"}"#)
        scene.send(#"{"id":"other","op":"stop"}"#)
        #expect(scene.engine.isListening)
    }

    @Test func aStopWaitsForThePendingTranscript() {
        let scene = Scene().loaded()
        scene.platform.model.holdTranscripts = true
        scene.send(#"{"id":"c","op":"listen","purpose":"command"}"#)
        scene.play(frames(seconds: 1, speech: true))
        scene.send(#"{"id":"c","op":"stop"}"#)
        #expect(scene.events == [.speech])
        scene.platform.model.deferred.forEach { $0() }
        #expect(scene.events.last == .final(text: "part1", reason: .stopped))
    }

    @Test func theEndOfAFileStopsTheListen() {
        let scene = Scene().loaded()
        scene.platform.fileInputAllowed = true
        scene.send(#"{"id":"f","op":"listen","purpose":"command","file":"/tmp/x.wav"}"#)
        scene.play(frames(seconds: 1, speech: true))
        scene.platform.onEnd?()
        #expect(scene.events.last == .final(text: "part1", reason: .stopped))
    }

    @Test func fileInputIsRefusedUnlessTheHostAllowedIt() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"f","op":"listen","purpose":"command","file":"/tmp/x.wav"}"#)
        #expect(scene.events == [.error(.fileInputOff, "file input is for tests")])
        #expect(!scene.engine.isListening)
    }

    @Test func listeningWithoutAModelSaysSo() {
        let scene = Scene()
        scene.send(#"{"id":"a","op":"listen","purpose":"command"}"#)
        #expect(scene.events == [.error(.modelMissing, "load a model first")])
    }

    @Test func aModelWithTheWrongHashIsRefused() {
        let scene = Scene()
        let wrong = String(repeating: "0", count: 64)
        scene.send(#"{"id":"l","op":"load","path":"\#(scene.modelPath)","sha256":"\#(wrong)","vad":"v"}"#)
        #expect(scene.events == [.error(.badModel, "the model file does not match its sha256")])
        scene.send(#"{"id":"s","op":"status"}"#)
        guard case .status(let status) = scene.events.last else { Issue.record("no status"); return }
        #expect(status.model == false)
    }

    @Test func aSecondListenIsBusy() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"a","op":"listen","purpose":"command"}"#)
        scene.send(#"{"id":"b","op":"listen","purpose":"command"}"#)
        #expect(scene.sent.last?.0 == "b")
        #expect(scene.events.last == .error(.busy, "already listening"))
    }

    @Test func aDeniedMicrophoneIsReported() {
        let scene = Scene().loaded()
        scene.platform.startFailure = .micDenied
        scene.send(#"{"id":"a","op":"listen","purpose":"command"}"#)
        #expect(scene.events == [.error(.micDenied, "the microphone could not start")])
        #expect(!scene.engine.isListening)
    }

    @Test func listeningStopsSpeakingFirst() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"s","op":"speak","text":"Nothing needs you."}"#)
        scene.send(#"{"id":"a","op":"listen","purpose":"command"}"#)
        #expect(scene.platform.hushes == 1)
        #expect(scene.sent.first?.0 == "s")
        #expect(scene.events == [.interrupted])
    }

    @Test func hushInterruptsAnAnswer() {
        let scene = Scene().loaded()
        scene.send(#"{"id":"s","op":"speak","text":"Two chats need you."}"#)
        scene.send(#"{"id":"h","op":"hush"}"#)
        #expect(scene.events == [.interrupted, .hushed])
    }

    @Test func keyEventsCarryTheKeysRequestId() {
        let scene = Scene()
        scene.send(#"{"id":"k","op":"keys","fn":true,"hold":false}"#)
        scene.platform.onKey?(.fnTwice)
        #expect(scene.sent.map(\.0) == ["k", "k"])
        #expect(scene.events == [.keys, .key(.fnTwice)])
    }

    @Test func keysWithoutInputMonitoringFail() {
        let scene = Scene()
        scene.platform.keysAllowed = false
        scene.send(#"{"id":"k","op":"keys","fn":true,"hold":false}"#)
        #expect(scene.events == [.error(.failed, "Input Monitoring is not allowed")])
    }

    @Test func unknownRequestsAnswerInvalid() {
        let scene = Scene()
        scene.send(#"{"id":"x","op":"record_forever"}"#)
        scene.send("not json")
        #expect(scene.sent.map(\.0) == ["x", nil])
    }
}
