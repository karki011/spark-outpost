# Voice

> **Status: Phase 1 built (2026-10-15); see [Built in Phase 1](#built-in-phase-1) for what it settled and which real tests wait on the microphone grant.** Push-to-talk speech on the Mac: dictation into Spark drafts, spoken commands that open a prefilled, confirmable screen ("Spark, start a chat in spark-outpost for CP-49084 to fix the login redirect"), and questions about Spark that it can answer out loud. Speech becomes text, and answers become speech, on this Mac; audio never leaves it. Mac app only, off until the user turns it on. The owner's decisions are in [Decided](#decided).

## Pieces

| Piece     | Where                                      | Does                                                                                                 |
| --------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Helper    | `apps/desktop/voice/` (Swift package)      | `spark-voice`: mic, Silero VAD, whisper.cpp, the Fn monitor, spoken answers                          |
| Host      | `apps/desktop/src/voice/`                  | Starts the helper; shortcuts, permissions, model download                                            |
| Contracts | `packages/contracts/src/voice.ts`          | Helper messages, the bridge, the model manifest                                                      |
| Matcher   | `apps/web/src/voice/commands.ts`           | Templates and fuzzy matching, pure like `ask-fast-path.ts`                                           |
| UI        | `apps/web/src/voice/`, island and composer | Mic button, listening view, result screens (`speech` names: `spark/voice.ts` is Scout's personality) |
| Settings  | Settings → **Voice**                       | Switch, model, language, shortcut, hold to talk, **Speak answers**                                   |

## Process and permissions

### A helper, like Mac control

**Recommendation: one signed Swift command-line helper, `spark-voice`, started by Electron main on first use, kept with its model loaded, and spoken to as JSON lines over stdin and stdout**, the [Mac control](MAC_CONTROL.md#a-swift-helper-not-a-node-addon) pattern. It records with `AVAudioEngine` and speaks with `AVSpeechSynthesizer`; whisper.cpp (pinned to a release, v1.9.5 today) is linked in as a static library, with Metal on arm64 and Accelerate and AVX on x64. A crash or hang never touches main or the window. `pnpm desktop:voice` builds it into `.local/voice/<arch>/` (macOS 12.0 minimum, both arches); packaging stages it, the Silero model and licence notices to `Contents/Resources/voice/`, checked in `afterPack` like [Bundled tmux](RELEASES.md#bundled-tmux).

### Permissions

| Need              | Where                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Usage string      | `NSMicrophoneUsageDescription` in `mac.extendInfo` (`scripts/builder-config.ts`)                  |
| Hardened runtime  | `com.apple.security.device.audio-input` in `build/entitlements.mac.plist`                         |
| Microphone        | `systemPreferences.askForMediaAccess('microphone')` when Voice is turned on                       |
| Fn key (optional) | Input Monitoring, asked with `CGRequestListenEventAccess()` only when the user picks **Fn twice** |
| Denied            | **Open Microphone settings** or **Open Input Monitoring settings**                                |

The usage string: "Spark Outpost listens only while you press the Voice shortcut or the mic button, and turns your speech into text on this Mac."

**Which process macOS credits.** A child a signed app starts from its bundle should count as **Spark Outpost**, as [with Accessibility](MAC_CONTROL.md#how-macos-attributes-the-permissions); in dev it is **Electron**. **To verify** on a Developer ID build: the Microphone and Input Monitoring entries, and that the helper gets `audio-input` through `entitlementsInherit`.

**Only the helper records.** Chromium asks macOS for the microphone before Electron's permission handlers run, so while the app's permission is undetermined a page's `getUserMedia` would raise the system prompt and wait. Phase 1 registers a session preload (`media-guard-page.ts`) on the app session and every Browser pane partition that makes `getUserMedia` and the legacy calls reject at once with `NotAllowedError`, in every frame of a pane page; the handlers still deny `media`.

## The shortcut

**Fn pressed twice, like macOS Dictation, when the Fn monitor can run; otherwise ⌥⇧V**, changeable in Settings → Spark → Around the app (`parseShortcuts` keeps it distinct from the other two).

- **Fn needs a key monitor.** Electron's `globalShortcut` can't register a modifier. The helper runs a listen-only `CGEventTap` on `flagsChanged` (`maskSecondaryFn`), which needs Input Monitoring; an `NSEvent` global monitor would need Accessibility. Two Fn presses within 400 ms with no other key between count. While secure input is on, macOS sends the tap nothing; ⌥⇧V still works.
- **macOS may already use Fn.** **Press 🌐 key to** (input source, Emoji, Dictation) and the Dictation shortcut (**Press 🌐 twice**) act on the same presses, and a listen-only tap can't stop them. Spark offers Fn twice only when 🌐 does nothing and Dictation doesn't use it; otherwise it names the setting in the way and uses ⌥⇧V. The preference keys are **to verify** (`AppleFnUsageType` in `com.apple.HIToolbox` is expected).
- **Toggle is the model:** press to start, press to stop, mic buttons alike. Since the monitor sees key-up, **Hold to talk** is an option (off by default).

## Helper protocol

Requests carry an `id`; the host validates every message with zod.

| Request  | Fields                                                                                  | Answer                                               |
| -------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `status` | none                                                                                    | `mic`, `inputMonitoring`, `model`, `fnSetting`, arch |
| `load`   | `path`, `sha256`                                                                        | `loaded`, or `bad_model`                             |
| `listen` | `purpose` (`command`, `dictation`, `confirm`), `language`, `hint`, `file` (test builds) | events, then `final`                                 |
| `stop`   | `id`                                                                                    | transcribes the open segment, then `final`           |
| `cancel` | `id`                                                                                    | `cancelled`; audio and text dropped                  |
| `speak`  | `text`, `voice`                                                                         | `spoken`, or `interrupted`                           |
| `hush`   | none                                                                                    | stops speaking at once                               |
| `keys`   | `fn`, `hold`                                                                            | `fn_twice`, `key_down`, `key_up` events              |

Events: `level` (for the meter), `speech`, `partial` (dictation) and `final` (`text`, `reason`: `stopped`, `paused`, `silence`); errors `mic_denied`, `no_input_device`, `model_missing`, `busy`.

- **Bounded memory.** Samples are never written to disk or sent over the pipe. Each speech segment VAD closes (or cuts at 30 s, whisper's window) is transcribed at once and dropped, so the helper holds one segment (about 2 MB) plus text.
- **Whisper invents text on silence** ("Thank you."): only VAD's speech spans are transcribed, and an empty result shows **Didn't catch that**.
- **Hint** is whisper's initial prompt, built locally from project names, chat titles and ticket prefixes so `spark-outpost` and `CP` are recognised.

### When listening ends

| Purpose              | Ends when                                                    |
| -------------------- | ------------------------------------------------------------ |
| `command`, `confirm` | About 1.5 s of silence after speech (`paused`), or a press   |
| `dictation`          | A press only; it runs through pauses                         |
| All                  | Esc cancels; 30 s with no speech stops; in hold mode, key-up |

## Models

| Model                             | File and size                           | How                            |
| --------------------------------- | --------------------------------------- | ------------------------------ |
| Silero VAD v6.2.0                 | `ggml-silero-v6.2.0.bin`, 885,098 bytes | Bundled                        |
| Whisper base, multilingual, 5-bit | `ggml-base-q5_1.bin`, 59,707,625 bytes  | Downloaded on turning Voice on |
| Whisper small, large-v3-turbo     | Pinned when added (Phase 2)             | Optional, Settings             |

Pinned sha256 (the Hugging Face LFS oid, read 2026-10-15):

- `ggml-silero-v6.2.0.bin`: `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`
- `ggml-base-q5_1.bin`: `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898`

**Why multilingual base, downloaded.** Dictation works in the user's language; **Language** defaults to the Mac's preferred one, since detection on a two-second command is unreliable, and the command grammar is English in Phase 1. OpenAI's [Whisper README](https://github.com/openai/whisper#available-models-and-languages) says the `.en` models "tend to perform better" for English, especially at base, so English accuracy on names and keys is **to measure**, with Intel latency. Voice is off by default, so a one-time 60 MB download beats growing every install and update.

**Integrity.** The manifest holds these hashes and sizes and URLs pinned to a commit, never `main`: `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin` (Silero from `ggml-org/whisper-vad` at `9ffd54a1e1ee413ddf265af9913beaf518d1639b`). Main downloads with Electron `net` to `<userData>/voice/<sha256>.partial`, hashing as it streams; a wrong size or hash deletes it (**The download didn't check out**), otherwise it is renamed into place. The helper checks the hash again on `load`.

## Commands and questions

Matching runs locally in TypeScript with a subset of Home Assistant's [hassil](https://github.com/OHF-Voice/hassil/blob/main/docs/template_syntax.md) template syntax: `[optional]`, `(a|b)`, `{list}` slots and a `{text}` wildcard. Spark writes its own templates and borrows no code or sentences. A leading "Spark" is dropped.

| Intent       | Templates (examples)                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `start_chat` | `(start\|new) [a] chat (in\|for) {project} [for [ticket] {ticket}] [to] {text}`; `work on {ticket} in {project} [{text}]`                  |
| `open`       | `(open\|show [me]\|find) [the] ({chat}\|{ticket}) [chat]`                                                                                  |
| `ask_fast`   | `who needs me`, `what's running`, `what did I spend [today]`, `what tickets do I have [pending]`, `(what's the status of\|how's) {ticket}` |
| `reply`      | `reply to {chat} [saying] {text}`                                                                                                          |
| `confirm`    | `(yes\|send [it]\|open it)`, `(no\|cancel)`, only while a voice result is open                                                             |

### Slots and fuzzy matching

- **Lists are the user's real names** from the island's query cache: projects (name and folder), chat titles (newest 200) and the Tickets inbox's keys and titles. The matcher never invents one.
- **Normalising:** lower case, filler dropped, number words to digits, spelled letters joined with a sound-alike table (see → C, oh → 0 by digits). "C P four nine zero eight four" becomes `cp49084`, matching `CP-49084`. A key that parses but isn't cached is looked up with the ticket detail route, as typing it would.
- **Scoring:** token-set similarity, Jaro-Winkler per token; a candidate at 0.85 or above and 0.1 ahead of the next is preselected.
- **Ambiguity asks which one:** the top three above 0.6, picked by click, ↑↓ and Enter, or by voice ("the first one"). Nothing above 0.6 says **No project called "…"**.

### Answers

- **Instant answers** read Spark's local data with no model call: `ask-fast-path.ts` for who needs you, what's running and spend, and the Tickets inbox cache for pending tickets (counts by section, the top three) and a cached ticket's status, chat and pull request.
- **Any other question** goes into **Ask Spark** as text, sent on the same confirm as a typed question; its read-only session looks things up with the Spark tools (`spark_tickets` `list`, `read`, `search` for tickets).
- **Answers never act.** They may offer **Open** buttons; nothing in an answer starts, sends or changes anything.

## UI flows

1. **Listening:** the island opens with Scout listening, a meter and **Listening… Esc to cancel**, and takes focus.
2. **Working it out** while whisper runs; the transcript then shows above the result.
3. **The result**, focused on its confirm button or text box:

| Intent       | Screen                                                                      | Confirm                  |
| ------------ | --------------------------------------------------------------------------- | ------------------------ |
| `start_chat` | **New chat** with the project chip, a removable ticket chip (new), the task | Enter, Send, or "send"   |
| `open`       | A result card of what was found, the best match preselected                 | Enter, a click, or "yes" |
| `ask_fast`   | **Ask Spark** with the answer                                               | none: it only shows      |
| `reply`      | **Chats** → the chat → **Reply**, text filled                               | Enter, Send, or "send"   |
| none         | **Ask Spark** with the transcript in the box                                | Enter, Ask, or "send"    |

With a ticket, Send uses the existing ticket start route (`projectId`, `note` = the task) and shows its **Move to In Progress** choice, since that writes to Jira or Linear. **Confirming by voice** needs a fresh press; Spark never listens on its own after a result, and `confirm` is bound to that result's id.

**Speak answers** (off by default) reads aloud instant answers, Ask Spark's reply as plain text, what an `open` card found ("Found Fix login redirect. Open it?") and **Didn't catch that**, with an installed Apple system voice. Esc or a new press stops it before the mic opens, so Spark never records itself; the mic is not left open to hear the user talk over it.

**Dictation:** a mic button in the chat composer (`Composer.tsx`) and the island's text boxes, with partial text dimmed at the caret; the draft is never sent. In a Terminal session the user sends through the existing `POST /conversations/:id/terminal/message` route, its refusals unchanged (an agent waiting for an answer, a CLI menu, a leading `/` or `!`); a spoken "slash" stays a word. Paired devices use their keyboard's dictation.

**First run:** **Turn on Voice** (Settings, or the first mic press) asks for the mic, downloads the model, then offers **Use Fn twice** (asks for Input Monitoring, or names the Keyboard setting using 🌐 and opens it) or **Use ⌥⇧V**.

## Safety

- **Push-to-talk only:** no always-listening, no wake word; the mic is open only with the listening view on screen. The Fn monitor watches modifier changes only, and only when Fn twice is picked.
- **Voice never starts work on its own:** commands open a screen the user confirms, dictation is never sent automatically, answers never act.
- **Never by voice:** approval and denial cards, pushes, pull requests, Mac control, Settings, remote control, anything with hold-to-confirm; `confirm` answers only its own voice result.
- **A transcript is the user's message only once the user sends it**; the matcher's choice grants nothing.
- **Paired devices** get no voice: the bridge is Electron IPC, not an HTTP route.
- **Never stored:** audio. Command transcripts stay in memory until the screen closes, unlogged and unaudited.

## What leaves the computer

| What                                 | Where to                                 | When                         |
| ------------------------------------ | ---------------------------------------- | ---------------------------- |
| Audio, spoken answers, key presses   | Nowhere                                  | Never                        |
| A model file request                 | Hugging Face and its CDN                 | Once per model               |
| Dictated text, an Ask Spark question | The chat's or Ask Spark's model provider | When the user sends it       |
| A ticket key not in the cache        | Jira or Linear                           | As a lookup, as typing would |
| A ticket start                       | Jira or Linear                           | On Send, as shown            |

## Accessibility

- Mic buttons have `aria-pressed` and the labels **Dictate** and **Stop dictating**; every screen works by keyboard, and Voice Control can click **Dictate**.
- State is text in an `aria-live` region, not colour or motion alone; the meter respects reduced motion. **Speak answers** stays off while VoiceOver runs.

## Testing

**Automated:** matcher unit tests on text; Swift tests with fake audio, clock and key events (end rules, Fn twice versus Fn with a key, hold, cancel, `bad_model`); a fake helper (`SPARK_FAKE_VOICE=1`) for browser specs of every flow and denial.

### Required real tests on this Mac

No Phase 1 PR is done until each check below has run on this Mac and the PR reports **pass** or **fail** for it, with evidence (a log line, a screenshot, a capture summary).

- **Setup:** the dev app launched with `open -n -a Electron.app --env SPARK_APP_DATA=<throwaway folder>`, granted the microphone and the key monitor (Input Monitoring or Accessibility; credited to Electron in dev). On the signed build, record which entry System Settings shows.
- **Speech with no human:** each phrase played with macOS `say` through the speakers into the built-in mic, and as a recorded WAV through the helper's `file` input, so results don't depend on room noise:
  1. "start a chat in feature web apps for C P four nine zero eight four add creator email"
  2. "open the dashboards chat"
  3. "what tickets do I have pending"
  4. "who needs me"
  5. a dictated chat message with pauses.

| Check                          | Evidence                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Transcript accurate            | Transcript beside each phrase, `say` and WAV                                         |
| Fuzzy match right              | 1 picks the feature-web-apps project and CP-49084; 2 the Dashboards chat             |
| Prefilled card, nothing starts | Screenshot; no run or message until Enter or "send"                                  |
| Spoken answer plays and stops  | 3 and 4 spoken; Esc and a new press each stop it                                     |
| End rules                      | A command ends after about 1.5 s of silence; 5 runs through its pauses until a press |
| Shortcut                       | Fn twice starts listening; with 🌐 set to Emoji, Spark says why and uses ⌥⇧V         |
| Esc cancels                    | No transcript, no result                                                             |
| Audio never leaves             | `nettop` during a run: no connection but the provider's for a sent message           |
| Browser pane has no mic        | `getUserMedia` on a page in the pane is denied                                       |
| Real Claude, chat              | A dictated message sent in a Spark chat; Claude answers                              |
| Real Claude, Terminal session  | A dictated message reaches a Claude Terminal session through the message route       |
| Ask Spark                      | A spoken free-form question, sent, answered and spoken                               |

## Built in Phase 1

| Piece  | Where                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Helper | `apps/desktop/voice/`: `VoiceCore` (end rules, Fn twice, protocol, engine; Swift tests), `spark-voice` (mic, whisper, VAD, voices, key tap) |
| Build  | `scripts/voice-bundle.ts`: whisper.cpp v1.9.5 tarball (sha256 pinned), static cmake build, Silero, notices; `afterPack` checks              |
| Host   | `apps/desktop/src/voice/`: `helper-process.ts`, `voice.ts` (controller), `model.ts` (download), `host.ts`, `fake-helper.ts`                 |
| Web    | `apps/web/src/voice/`: `commands.ts`, `normalise.ts`, `fuzzy.ts`, `templates.ts`, `speech-machine.ts`, `use-speech-island.ts`               |
| UI     | `SpeechScreen.tsx` in the island, `MicButton.tsx` (composer, quick chat, Ask Spark, reply), `TerminalDictation.tsx`, `VoiceSection.tsx`     |

How Phase 1 settles what the design left open:

- **Settings live in Electron main** (`voice-settings.json` beside `companion.json`), reached over IPC only: no route, no migration, nothing a paired device can reach.
- **The shortcut is ⌥⇧V**, fixed for now; the island's shortcuts refuse it. Changing it waits for the Settings regrouping.
- **Protocol:** every message carries `id` and `event`; `load` also takes the bundled VAD path; `stop` and `cancel` name the listen's id; a third `listen` purpose, `confirm`, ends like a command.
- **File input** is accepted only when the host starts the helper with `--allow-file-input`, which only an unpackaged app with `SPARK_VOICE_FILE_INPUT=1` does; that app also exposes `testPress(wav)`, which presses the shortcut with a WAV in place of the mic.
- **Fn twice is offered** when `AppleFnUsageType` in `com.apple.HIToolbox` is 0 and `Dictation Enabled` in `com.apple.assistant.support` is off. An absent `AppleFnUsageType` counts as Emoji (the macOS default). Dictation's own shortcut key is not read, so Dictation on with another shortcut still blocks Fn twice. **Hold to talk** listens while the second Fn press is held.
- **Ticket starts** from a voice chat use the ticket start route with **Move to In Progress** on by default; a spoken `open` of a ticket shows its status in Ask Spark (the island has no ticket page).
- **A phrase that isn't yes, no or a pick** while a result is open is matched as a new command.
- **Partial dictation** shows dimmed beside the mic button, not at the caret.
- **Terminal sessions:** **Dictate** fills a one-line box, sent with **Send to <agent>** through `POST /conversations/:id/terminal/message`, its refusals shown as returned.

### Verified, and not

On 2026-10-15 (Apple silicon, macOS 26.5, Electron 44.4.5 in the Developer ID signed **Spark Outpost Dev** shell, throwaway data folder, Claude Code CLI signed in): the helper built for arm64 and x64 (minos 12.0, system libraries only) and its Swift tests passed. Through the helper's file input, `say` WAVs gave: 1 "Start a chat and feature, web apps, for CP49084, at Creator Email.", 2 "Open the Dashboards Chat.", 3 "What tickets do I have pending?", 4 "Who needs me?", 5 as a command "please check the login redirect." (`paused` after the first 2 s gap) and as a dictation all three sentences through both pauses (`stopped`). In the app with `testPress`, 1 opened **New chat** with feature-web-apps, CP-49084 and the task and started nothing; 2 showed **Found Dashboards** preselected; 3 and 4 answered at once and were spoken; Esc and a new press each stopped a spoken answer; Esc during a listen gave `cancelled` and no result; a spoken free-form question went to Ask Spark, "send it" sent it, real Claude answered in 19 s and the answer was spoken. `nettop` over the session showed no socket for `spark-voice`. **Not yet verified, waiting on the microphone and Input Monitoring grant:** `say` through the speakers into the mic, Fn twice and the 🌐 check, the model download on **Turn on Voice**, a dictated message in a chat and in a Claude Terminal session with real Claude, and a Browser pane page's `getUserMedia`. With the media guard, `getUserMedia` in the main window and the island rejects with `NotAllowedError` in 0–1 ms (it hung before the guard, because Chromium asks macOS first).

## Phases

1. **Push-to-talk, commands, questions, dictation and spoken answers:** the helper, permissions, the base model, Fn twice and ⌥⇧V, the matcher, island screens, mic buttons, Speak answers with Apple system voices, Settings → **Voice**.
2. **Better voices and models:** Kokoro-82M as an optional download only if it runs without espeak-ng (misaki's lexicon alone, unknown words spelled out); small and large-v3-turbo; Parakeet through FluidAudio on macOS 14+, with whisper.cpp the floor for Intel and macOS 12–13.

## Decided

By the owner on 2026-10-15: everything in [Safety](#safety), whisper.cpp with Silero VAD, local matching, dictation, the Terminal message route, and no voice on paired phones in v1; **open** shows a result card; Voice **answers questions about Spark**, tickets included, read-only and out loud, in Phase 1; **Fn twice** with ⌥⇧V as the fallback; the **multilingual base** model; **1.5 s of silence** ends a command, not a dictation; the real tests above are required. Rejected: Chromium Web Speech (sends audio to Google), Cactus Whistle (closed engine source), openWakeWord and Porcupine.

Chosen by default: toggle as the model, a download rather than a bundle, ticket starts through the start route.

## Open questions

1. **Parakeet's licence:** the NVIDIA cards say CC-BY-4.0 (attribution in the licences screen); confirm the exact FluidAudio CoreML conversion before shipping it.

## Licences

Read 2026-10-15. Notices for whisper.cpp, the weights and Silero ship in `Contents/Resources/voice/licenses/`, as tmux's do; Apple system voices are part of macOS.

| Component                | Licence                                 | Source                                                                                                                                                         |
| ------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| whisper.cpp              | MIT                                     | [ggml-org/whisper.cpp LICENSE](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)                                                                    |
| Whisper weights (ggml)   | MIT                                     | [openai/whisper LICENSE](https://github.com/openai/whisper/blob/main/LICENSE), [ggerganov/whisper.cpp card](https://huggingface.co/ggerganov/whisper.cpp)      |
| Silero VAD               | MIT                                     | [snakers4/silero-vad LICENSE](https://github.com/snakers4/silero-vad/blob/master/LICENSE), [ggml-org/whisper-vad](https://huggingface.co/ggml-org/whisper-vad) |
| hassil (syntax only)     | Apache-2.0                              | [OHF-Voice/hassil LICENSE](https://github.com/OHF-Voice/hassil/blob/main/LICENSE.md)                                                                           |
| Kokoro-82M (Phase 2)     | Apache-2.0                              | [hexgrad/Kokoro-82M card](https://huggingface.co/hexgrad/Kokoro-82M)                                                                                           |
| misaki (Kokoro's G2P)    | Apache-2.0; falls back to espeak-ng     | [hexgrad/misaki](https://github.com/hexgrad/misaki)                                                                                                            |
| espeak-ng (not used)     | GPL-3.0                                 | [espeak-ng/espeak-ng](https://github.com/espeak-ng/espeak-ng)                                                                                                  |
| Parakeet TDT 0.6B v2, v3 | CC-BY-4.0                               | [nvidia/parakeet-tdt-0.6b-v3 card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)                                                                         |
| FluidAudio               | Apache-2.0 code; macOS 14+              | [FluidInference/FluidAudio](https://github.com/FluidInference/FluidAudio)                                                                                      |
| openWakeWord (not used)  | Apache-2.0 code, models CC BY-NC-SA 4.0 | [dscripka/openWakeWord README](https://github.com/dscripka/openWakeWord#license)                                                                               |
| Porcupine (not used)     | Needs a Picovoice Console AccessKey     | [Picovoice/porcupine README](https://github.com/Picovoice/porcupine)                                                                                           |
