# Voice

> **Status: designed, not built (2026-10-15).** Push-to-talk speech on the Mac: dictation into any Spark draft, and spoken commands that open a prefilled, confirmable Spark screen ("Spark, start a chat in spark-outpost for CP-49084 to fix the login redirect"). Speech is turned into text on this Mac by open-source models; audio never leaves it. Mac app only, off until the user turns it on. The owner's decisions are in [Decided](#decided).

## Pieces

| Piece     | Where                                      | Does                                                                       |
| --------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| Helper    | `apps/desktop/voice/` (Swift package)      | `spark-voice`: records the mic, Silero VAD, whisper.cpp, level meter       |
| Host      | `apps/desktop/src/voice/`                  | Starts the helper, the shortcut, mic permission, model download and checks |
| Contracts | `packages/contracts/src/voice.ts`          | Helper messages, the bridge, the model manifest (URL, size, sha256)        |
| Matcher   | `apps/web/src/voice/commands.ts`           | Templates and fuzzy matching, a pure function like `ask-fast-path.ts`      |
| UI        | `apps/web/src/voice/`, island and composer | Mic button, listening state, prefilled screens                             |
| Settings  | Settings → **Voice**, `companion-settings` | Switch, model, shortcut; spoken replies in Phase 2                         |

`apps/web/src/spark/voice.ts` already names Scout's personality `Voice`; the new code uses `speech` names (`SpeechState`, `useSpeech`) to keep the two apart.

## Process and permissions

### A helper, like Mac control

**Recommendation: one small signed Swift command-line helper, `spark-voice`, started by Electron main on first use, kept with its model loaded while the app runs, and spoken to as JSON lines over stdin and stdout**, the [Mac control](MAC_CONTROL.md#a-swift-helper-not-a-node-addon) pattern. Swift records with `AVAudioEngine`; whisper.cpp (pinned to a release tag, v1.9.5 today) is built as a static library and linked in, with Metal on arm64 and Accelerate and AVX on x64. A crash or hang in inference never touches main or the window.

- **Build and sign** as [Bundled tmux](RELEASES.md#bundled-tmux) does: `pnpm desktop:voice` builds into `.local/voice/<arch>/` (macOS 12.0 minimum, both arches); packaging stages it with the Silero model and the licence notices to `Contents/Resources/voice/{bin,models,licenses}`, and `afterPack` fails on a missing binary, the wrong CPU, a library outside `/usr/lib` and `/System`, or a newer macOS.

### The microphone

| Need             | Where                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| Usage string     | `NSMicrophoneUsageDescription` in `mac.extendInfo` (`scripts/builder-config.ts`)  |
| Hardened runtime | `com.apple.security.device.audio-input` in `build/entitlements.mac.plist`         |
| Asking           | `systemPreferences.askForMediaAccess('microphone')` when the user turns Voice on  |
| Status           | `systemPreferences.getMediaAccessStatus('microphone')`, refreshed on window focus |
| Denied           | **Open Microphone settings** (`x-apple.systempreferences:…Privacy_Microphone`)    |

The usage string: "Spark Outpost listens only while you press the Voice shortcut or the mic button, and turns your speech into text on this Mac."

**Which process macOS credits.** As with Accessibility, a child a signed app starts from inside its bundle should count as **Spark Outpost**, so the helper has no Microphone entry of its own. **To verify in Phase 1** on a Developer ID build: the System Settings list, and that the helper gets the `audio-input` entitlement through `entitlementsInherit` (the same plist today). The dev app launched from a terminal is credited to that terminal app, as in [Mac control](MAC_CONTROL.md#how-macos-attributes-the-permissions); launch it with `open`.

**Only the helper records.** No renderer needs `getUserMedia`. Today only `browser/sessions.ts` sets permission handlers, so once the entitlement exists the app's own windows could ask for the mic: Phase 1 denies `media` on the app session too. The Browser pane's partitions keep denying every permission ([Browser](BROWSER.md)).

## Helper protocol

Requests carry an `id`; every message is validated with zod in the host.

| Request           | Fields                                                | Answer                                                      |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| `status`          | none                                                  | `mic` (granted, denied, undetermined), `model` loaded, arch |
| `load`            | `path`, `sha256`                                      | `loaded`, or `bad_model` when the hash differs              |
| `listen`          | `purpose` (`command`, `dictation`, `confirm`), `hint` | events below, then `final`                                  |
| `stop`            | `id`                                                  | transcribes what was heard, then `final`                    |
| `cancel`          | `id`                                                  | `cancelled`; the audio is dropped untranscribed             |
| `speak` (Phase 2) | `text`, `voice`                                       | `spoken`, or `cancelled`                                    |

Events during `listen`: `level` (0 to 1, ten a second, for the meter), `speech` (VAD heard speech start), `partial` (text so far, dictation only) and `final` (`text`, `ms`, `reason`: `stopped`, `silence`). `error` carries a code: `mic_denied`, `no_input_device`, `model_missing`, `busy`.

- **Audio stays in the helper's memory.** 16 kHz mono float samples in one buffer, never written to disk, never sent over the pipe, cleared after `final` or `cancel`. One `listen` at a time; a second answers `busy`.
- **Silence.** Silero VAD runs on every 32 ms frame. After 30 s with no speech the helper stops on its own (`reason: silence`); there is no length cap.
- **Whisper invents text on silence** ("Thank you."): only the spans VAD marked as speech are transcribed, and a `final` with no speech span, or only punctuation, is empty and shows **Didn't catch that**.
- **Hint.** `hint` is whisper's initial prompt, built locally from the user's project names, chat titles and ticket prefixes, so names like `spark-outpost` and `CP` are recognised. It never leaves the helper.

## Models

| Model                                   | File                           | Size     | sha256 (LFS oid) | How                            |
| --------------------------------------- | ------------------------------ | -------- | ---------------- | ------------------------------ |
| Silero VAD v6.2.0                       | `ggml-silero-v6.2.0.bin`       | 885 KB   | `2aa269b7…6987`  | Bundled in the helper          |
| Whisper base.en, 5-bit (default)        | `ggml-base.en-q5_1.bin`        | 59.7 MB  | `4baf70dd…dd2f`  | Downloaded on turning Voice on |
| Whisper small.en, 5-bit (Phase 2)       | `ggml-small.en-q5_1.bin`       | 190.1 MB | `bfdff489…ad30`  | Optional, Settings             |
| Whisper large-v3-turbo, 5-bit (Phase 2) | `ggml-large-v3-turbo-q5_0.bin` | 574.0 MB | `39422170…a7e2`  | Optional, multilingual         |

**Why base.en, downloaded.** Voice is off by default. Bundling 60 MB would grow every install and update, for both arches and for everyone; a download happens once, only for those who turn Voice on, and the pinned hash gives a bundle's integrity. base.en is the smallest model we expect to get project names and ticket letters right; tiny.en (32 MB) is the fallback if it is too slow on older Intel Macs. Accuracy and latency are **to measure** in Phase 1.

**Integrity.** The manifest in `packages/contracts/src/voice.ts` holds each file's full sha256, byte size and a URL pinned to a commit, never `main`: `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/<file>` (Silero from `ggml-org/whisper-vad` at `9ffd54a1e1ee413ddf265af9913beaf518d1639b`). Main downloads with Electron `net` to `<userData>/voice/<sha256>.partial`, hashing as it streams; a wrong size or hash deletes it and says **The download didn't check out**, otherwise it is renamed to `<sha256>.bin`. The helper checks the hash again on `load`. A failed download starts over.

## Commands

### Grammar

Matching runs in TypeScript, locally, after transcription, using a small subset of the template syntax of Home Assistant's [hassil](https://github.com/OHF-Voice/hassil/blob/main/docs/template_syntax.md): `[optional]`, `(a|b)` alternatives and `{list}` slots, plus a `{text}` wildcard. Spark writes its own templates and borrows no code; the Home Assistant sentence collection is not used.

| Intent       | Templates (a leading "Spark" or "hey Spark" is dropped)                                                     | Opens                               |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `start_chat` | `(start\|open\|new) [a] [new] chat (in\|for\|on) {project} [(for\|on) [ticket] {ticket}] [to] {text}`       | Island **New chat**, prefilled      |
|              | `work on [ticket] {ticket} (in\|for) {project} [to] [{text}]`                                               |                                     |
| `open`       | `(open\|show [me]\|go to) [the] [chat] {chat}` and `(open\|show [me]) [ticket] {ticket}`                    | The chat, or the ticket             |
| `ask_fast`   | `who needs me`, `(what's\|what is) running`, `what did I spend today` and their `ask-fast-path.ts` variants | Ask Spark's instant answer          |
| `reply`      | `reply to {chat} [saying] {text}`                                                                           | Island **Chats** → Reply, prefilled |
| `confirm`    | `(yes\|send [it]\|go [ahead]\|do it)`, `(no\|cancel\|never mind)`, only while a voice draft is open         | Sends or closes that draft          |

Anything that matches no template is put into **Ask Spark** as typed text, not sent.

### Slots and fuzzy matching

- **Lists are the user's real names** from the island's query cache: projects (name and folder), chat titles (newest 200) and the ticket inbox's keys and titles. The matcher never invents a name that is not in a list.
- **Normalising:** lower case, punctuation and filler ("um", "the") dropped, number words to digits, and spelled letters joined, with a small sound-alike table (see → C, pea → P, oh → 0 next to digits). "C P four nine zero eight four", "CP 49084" and "cp dash four nine oh eight four" all become `cp49084`, which matches the cached `CP-49084`. A key that parses but is not cached is looked up with the ticket detail route, as typing it into ticket search would.
- **Scoring:** token-set similarity with Jaro-Winkler per token, so "spark outpost" matches `spark-outpost` and "login fix" matches "Fix login redirect". One candidate at or above 0.85 and at least 0.1 ahead of the next is picked.
- **Ambiguity asks which one.** Otherwise the top three (above 0.6) show as buttons ("Which project? spark-outpost, spark-docs, spark-site"), answered by click, ↑↓ and Enter, or by pressing the shortcut and saying "the first one", "two" or a name. Nothing above 0.6 says **No project called "…"** with the list.

## UI flows

The global **Voice shortcut** (default ⌥⇧V, changeable next to the other two in Settings → Spark → Around the app; `parseShortcuts` checks all three are distinct) and the mic buttons all **press to start, press again to stop**.

**Why toggle, not hold.** Electron's `globalShortcut` reports only the key-down. Seeing the key-up from another app needs an event tap or a global key monitor, which need Input Monitoring or Accessibility: a second, bigger permission than the mic, just to see a key go up. Phase 1 toggles. Whether the helper can learn the key is still down without a permission (polling `CGEventSource.keyState`) is **to verify**; if it can, hold-to-talk is added for the shortcut.

1. **Listening.** The island opens on a listening view: Scout listening, a level meter, **Listening… press ⌥⇧V or Enter to stop, Esc to cancel**. The island takes focus, so Enter and Esc work there.
2. **Transcribing.** **Working it out…** for the second or so whisper takes; the transcript then shows above the result.
3. **The result**, always a prefilled screen with focus on its confirm button or text box:

| Intent       | Screen                                                                                                                                                                                                                                                                                                                 | Confirm                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `start_chat` | **New chat** with the project chip set, a ticket chip (new; removable) and the task in the text box. With a ticket, Send uses the existing ticket start route (`projectId`, `note` = the task) and shows its **Move to In Progress** choice, set to the user's last choice, because that move writes to Jira or Linear | Enter, Send, or "send" |
| `open`       | One match: **Open "Fix login redirect"** with Open focused. Several: which one                                                                                                                                                                                                                                         | Enter, click, or "yes" |
| `ask_fast`   | **Ask Spark** with the instant answer shown at once (local data, no model call); spoken in Phase 2 when turned on                                                                                                                                                                                                      | none: it only shows    |
| `reply`      | **Chats** → that chat → **Reply** with the text in the box                                                                                                                                                                                                                                                             | Enter, Send, or "send" |
| none         | **Ask Spark** with the transcript in the box, not sent                                                                                                                                                                                                                                                                 | Enter, Ask, or "send"  |

**Confirming by voice** needs a fresh press of the shortcut: Spark never listens on its own after a result. The `confirm` listen is bound to the id of that voice draft only; anything but a confirm phrase changes nothing and shows **Say "send" or "cancel"**.

**Dictation.** A mic button in the chat composer (`Composer.tsx`) and the island's New chat, Reply and Ask Spark boxes. Partial text shows dimmed at the caret; the final text replaces it, and the draft is never sent. Shown only in the Mac app (the desktop bridge reports Voice), never in a paired device's browser, whose keyboard dictation already works. In a Terminal session the user sends the draft through the existing `POST /conversations/:id/terminal/message` route, refusals unchanged (the agent waiting for an answer, a CLI menu showing, a leading `/` or `!`). A spoken "slash" or "bang" stays a word, never `/` or `!`.

## Safety

- **Push-to-talk only.** No always-listening, no wake word. The mic is open only between a press and the stop, with the listening view on screen.
- **Voice never starts work on its own.** Every command opens a prefilled screen; the user confirms with Enter, a click, or a spoken confirm after pressing the shortcut again. A dictated message is never sent automatically.
- **Never by voice:** approval and denial cards, pushes, pull requests, Mac control cards, Settings, remote control, and anything with hold-to-confirm. The `confirm` intent answers only its own voice draft, even with a card on screen.
- **A transcript is the user's message only once the user sends it**, as if typed. The matcher only fills slots from the user's own lists and a text box; it never runs a command, opens an address or picks a mode, and its choice grants nothing.
- **Paired devices** never record or run voice commands: the Voice bridge is Electron IPC, not an HTTP route, so the remote gateway has nothing to allow.
- **Never stored:** audio. Command transcripts live in memory until the screen closes and are not logged, audited or sent to Jev; a sent message is stored as any typed one.

## What leaves the computer

| What                                 | Where to                     | When                                                          |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------- |
| Audio                                | Nowhere                      | Never                                                         |
| A model file request                 | Hugging Face and its CDN     | Once per model, when the user turns Voice on or picks a model |
| Dictated text                        | The chat's model provider    | Only when the user sends it, as typed text                    |
| An unmatched transcript              | The Ask Spark model provider | Only when the user sends it from Ask Spark                    |
| A spoken ticket key not in the cache | Jira or Linear               | As a ticket lookup, as typing it would                        |
| A ticket start                       | Jira or Linear               | On Send, with **Move to In Progress** as shown                |
| Spoken replies (Phase 2)             | Nowhere                      | Spoken on this Mac                                            |

## Accessibility

- Mic buttons have `aria-pressed` and the labels **Dictate** and **Stop dictating**; every voice screen works by keyboard alone, and macOS Voice Control can click **Dictate** by name.
- State is text, not colour or motion alone: "Listening", "Working it out" and "Didn't catch that" go to an `aria-live` region; the meter respects reduced motion.
- A start and stop sound follows the island's **Sound** setting (off by default).
- The mic can hear VoiceOver; spoken replies stay off while VoiceOver runs.

## Testing

- **Fixture WAVs:** 16 kHz mono clips in `apps/desktop/voice/Tests/fixtures/`, recorded by the owner (commands, ticket keys spelled several ways, silence, noise). Real-model tests check the matched intent and slots, not exact words, and skip when the model is absent.
- **Matcher unit tests** on text: every template, normalising, key spellings, ambiguity, no match, nothing outside the lists picked.
- **Swift tests** with a fake audio source and clock: VAD, the 30 s silence stop, cancel dropping audio, empty results, `bad_model`.
- **Fake helper** (`SPARK_FAKE_VOICE=1`) replaying scripted protocol events, for host tests and browser specs of every flow, ambiguity, Esc, a denied mic and a bad hash.
- **Real on this Mac:** the packaged build's Microphone entry; real Claude in a chat (dictate, send, Claude answers) and in a Claude Terminal session (dictate, send through the message route, the `/` refusal); and "start a chat in spark-outpost for <ticket> …" with a connected ticket source.

## Phases

1. **Push-to-talk, commands and dictation, whisper.cpp:** the helper, mic permission, base.en download and checks, the Voice shortcut, the matcher with the five intents, the island screens, mic buttons, Settings → **Voice**.
2. **Spoken replies, bigger models, Parakeet:** spoken instant answers and short replies (off by default) with Apple system voices (`AVSpeechSynthesizer`, macOS 12+), Kokoro-82M as an optional download if out-of-vocabulary words work without espeak-ng; small.en and large-v3-turbo in Settings; Parakeet through FluidAudio on macOS 14+ (Apple silicon), whisper.cpp staying the floor for Intel and macOS 12–13.

## Decided

By the owner on 2026-10-15: everything in [Safety](#safety), whisper.cpp with Silero VAD, local matching, the five intents, dictation, the Terminal message route, and no voice on paired phones in v1. Rejected by the owner: Chromium Web Speech (sends audio to Google), Cactus Whistle (speech-to-text only, closed engine source), openWakeWord and Porcupine.

Chosen by default, not by the owner:

1. **Toggle, not hold**, until a permission-free key-up is verified.
2. **base.en 5-bit, downloaded** when Voice is turned on; Silero bundled.
3. **A ticket start goes through the ticket start route**, with its Move to In Progress choice shown.
4. **Instant answers show at once**; everything else waits for a confirm.
5. **Default shortcut ⌥⇧V.**

## Open questions

1. Should **open** act at once when there is exactly one match? Opening is navigation inside Spark, not work.
2. Is **⌥⇧V** right? It types ◊ in other apps while Voice is on.
3. **English only** in Phase 1 (base.en), or the multilingual base model at the same size with lower English accuracy?
4. Should a pause end a command early (VAD end of speech after about 1.5 s) instead of a second press?
5. **Kokoro's unknown words:** without espeak-ng, misaki has no fallback; spell them, drop them, or use Apple voices only?
6. **Parakeet's licence**: the NVIDIA cards say CC-BY-4.0 (attribution in the licences screen); confirm the exact FluidAudio CoreML conversion before shipping it.

## Licences and research notes

Read 2026-10-15.

| Component                         | Licence                                 | Source                                                                                                                                                         |
| --------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| whisper.cpp                       | MIT                                     | [ggml-org/whisper.cpp LICENSE](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)                                                                    |
| Whisper weights (ggml)            | MIT                                     | [openai/whisper LICENSE](https://github.com/openai/whisper/blob/main/LICENSE), [ggerganov/whisper.cpp card](https://huggingface.co/ggerganov/whisper.cpp)      |
| Silero VAD                        | MIT                                     | [snakers4/silero-vad LICENSE](https://github.com/snakers4/silero-vad/blob/master/LICENSE), [ggml-org/whisper-vad](https://huggingface.co/ggml-org/whisper-vad) |
| hassil (syntax only)              | Apache-2.0                              | [OHF-Voice/hassil LICENSE](https://github.com/OHF-Voice/hassil/blob/main/LICENSE)                                                                              |
| Home Assistant intents (not used) | CC-BY-4.0                               | [OHF-Voice/intents](https://github.com/OHF-Voice/intents)                                                                                                      |
| Kokoro-82M                        | Apache-2.0                              | [hexgrad/Kokoro-82M card](https://huggingface.co/hexgrad/Kokoro-82M)                                                                                           |
| misaki (Kokoro's G2P)             | Apache-2.0; its fallback is espeak-ng   | [hexgrad/misaki](https://github.com/hexgrad/misaki)                                                                                                            |
| espeak-ng (not used)              | GPL-3.0                                 | [espeak-ng/espeak-ng](https://github.com/espeak-ng/espeak-ng)                                                                                                  |
| Parakeet TDT 0.6B v2, v3          | CC-BY-4.0 ("Governing terms")           | [nvidia/parakeet-tdt-0.6b-v3 card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)                                                                         |
| FluidAudio                        | Apache-2.0 code; macOS 14+              | [FluidInference/FluidAudio](https://github.com/FluidInference/FluidAudio)                                                                                      |
| openWakeWord (not used)           | Apache-2.0 code, models CC BY-NC-SA 4.0 | [dscripka/openWakeWord README, License](https://github.com/dscripka/openWakeWord#license)                                                                      |
| Porcupine (not used)              | Needs a Picovoice Console AccessKey     | [Picovoice/porcupine README](https://github.com/Picovoice/porcupine)                                                                                           |

whisper.cpp's README lists macOS on Intel and Arm and Silero VAD support (`--vad`). FluidAudio's README puts its Sortformer diarizer under the NVIDIA Open Model License, a different model from Parakeet. Notices for whisper.cpp, the weights and Silero ship in `Contents/Resources/voice/licenses/`, as tmux's do.
