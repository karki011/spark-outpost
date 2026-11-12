# Voice

> **Status: Phase 1 built (2026-10-15); see [Built in Phase 1](#built-in-phase-1) for what it settled, the real tests run so far and what is still open. Phase 2 built: one speech model, [Parakeet](#models), through transcribe.cpp, and live words while listening; Whisper base and Whisper large v3 turbo, offered earlier in Phase 2, were removed; see [Phase 2](#phase-2-speech-models-and-live-words).** Push-to-talk speech on the Mac: dictation into Spark drafts, spoken commands that open a prefilled, confirmable screen ("Spark, start a chat in spark-outpost for CP-49084 to fix the login redirect"), and questions about Spark that it can answer out loud. Speech becomes text, and answers become speech, on this Mac; audio never leaves it. Mac app only, off until the user turns it on. The owner's decisions are in [Decided](#decided).

## Pieces

| Piece     | Where                                      | Does                                                                                                 |
| --------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Helper    | `apps/desktop/voice/` (Swift package)      | `spark-voice`: mic, Silero VAD, transcribe.cpp, the Fn monitor, spoken answers                       |
| Host      | `apps/desktop/src/voice/`                  | Starts the helper; shortcuts, permissions, model downloads and switching                             |
| Contracts | `packages/contracts/src/voice.ts`          | Helper messages, the bridge, the model manifest                                                      |
| Matcher   | `apps/web/src/voice/commands.ts`           | Templates and fuzzy matching, pure like `ask-fast-path.ts`                                           |
| UI        | `apps/web/src/voice/`, island and composer | Mic button, listening view, result screens (`speech` names: `spark/voice.ts` is Scout's personality) |
| Settings  | Settings → **Voice**, setup's **Voice**    | Switch, **Speech model**, shortcut, hold to talk, **Speak answers**                                  |

## Process and permissions

### A helper, like Mac control

**Recommendation: one signed Swift command-line helper, `spark-voice`, started by Electron main with the app (Voice on or off, as the 2026-11-12 run saw), kept with its model loaded once Voice is on, and spoken to as JSON lines over stdin and stdout**, the [Mac control](MAC_CONTROL.md#a-swift-helper-not-a-node-addon) pattern. It records with `AVAudioEngine` and speaks with `AVSpeechSynthesizer`; transcribe.cpp (pinned to a release, v0.4.1 today; it replaced whisper.cpp in Phase 2) is linked in as a static library, with Metal on arm64 and the CPU path (AVX2, FMA, F16C, tinyBLAS) on x64. A crash or hang never touches main or the window. `pnpm desktop:voice` builds it into `.local/voice/<arch>/` (macOS 12.0 minimum, both arches); packaging stages it, the Silero model and licence notices to `Contents/Resources/voice/`, checked in `afterPack` like [Bundled tmux](RELEASES.md#bundled-tmux).

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

**Fn pressed twice, like macOS Dictation, when the Fn monitor can run; otherwise a key shortcut**, ⌥⇧V by default and recorded in Settings → Voice → **Shortcut** (Change, Reset). `setShortcut` (IPC only) refuses keys without a modifier and keys the island's shortcuts use, and the island refuses the Voice shortcut; when another app holds the keys, the old shortcut is bound again and the card says so.

- **Fn needs a key monitor.** Electron's `globalShortcut` can't register a modifier. The helper runs a listen-only `CGEventTap` on `flagsChanged` (`maskSecondaryFn`), which needs Input Monitoring; an `NSEvent` global monitor would need Accessibility. Two Fn presses within 400 ms with no other key between count. While secure input is on, macOS sends the tap nothing; ⌥⇧V still works.
- **macOS may already use Fn.** **Press 🌐 key to** (input source, Emoji, Dictation) and the Dictation shortcut (**Press 🌐 twice**) act on the same presses, and a listen-only tap can't stop them. Spark offers Fn twice only when 🌐 does nothing and Dictation doesn't use it; otherwise it names the setting in the way and uses ⌥⇧V. The preference keys are **to verify** (`AppleFnUsageType` in `com.apple.HIToolbox` is expected).
- **Where a press lands.** A press goes to what the user is looking at. When the focused window is Spark's own (not the island) and a chat's message box is on screen, main sends `press` to that window and the box of the focused pane starts or stops dictation, exactly as its **Dictate** button does. Otherwise the island gets it and listens for a command or a question, as before. Which window that is comes from `pressWindow` (`voice/press-window.ts`): the focused Spark window when it has a box; nothing but the island while the island itself is focused; and, when Spark is the front app but no window holds focus (the island gives focus up without handing it back), the Spark window on screen that has a box. The 2026-11-12 run on a Mac found presses going to the island after a screen switch and after the island had been opened once, which is what the last rule is for. Run again on the same Mac at commit `219d655` with real ⌥⇧V presses: presses after Home → Chats and Chats → Home, and after Ask Spark was opened in the island and closed, all went to the window and dictated into the box on screen, and every second press stopped dictation with the text kept. One first press right after a launch went to the island and a second launch did not repeat it; an earlier run also saw the island ignore a press in its first seconds, so a press very soon after launch is still open. Each press logs `voice press: window` or `voice press: island`. A window says it has a box with `voice:press-target`; if the box turns out not to be on screen when the press arrives, the window hands the press back with `voice:press-island`. A press while anything is listening still stops that listen, wherever it started. In a chat the shortcut therefore dictates and does not run spoken commands; those stay on the island. A Terminal session's view has no target yet, so its press goes to the island.
- **Toggle is the model:** press to start, press to stop, mic buttons alike. Since the monitor sees key-up, **Hold to talk** is an option (off by default).

## Helper protocol

Requests carry an `id`; the host validates every message with zod.

| Request  | Fields                                                                                  | Answer                                               |
| -------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `status` | none                                                                                    | `mic`, `inputMonitoring`, `model`, `fnSetting`, arch |
| `load`   | `path`, `sha256`, `vad`                                                                 | `loaded`, or `bad_model`; replaces the loaded model  |
| `listen` | `purpose` (`command`, `dictation`, `confirm`), `language`, `hint`, `file` (test builds) | events, then `final`                                 |
| `stop`   | `id`                                                                                    | transcribes the open segment, then `final`           |
| `cancel` | `id`                                                                                    | `cancelled`; audio and text dropped                  |
| `speak`  | `text`, `voice`                                                                         | `spoken`, or `interrupted`                           |
| `hush`   | none                                                                                    | stops speaking at once                               |
| `keys`   | `fn`, `hold`                                                                            | `fn_twice`, `key_down`, `key_up` events              |

Events: `level` (for the meter), `speech`, `partial` and `final` (`text`, `reason`: `stopped`, `paused`, `silence`); errors `mic_denied`, `no_input_device`, `model_missing`, `busy`.

- **Partials for every purpose.** From Phase 2 the helper sends `partial` (`text`) about every 0.5 s while speech goes on, for `command`, `confirm` and `dictation` alike: the committed text plus the open segment's tentative words, so a later partial may change earlier words. No `partial` follows `final`. The host forwards them unchanged to the window that asked; a command is matched on `final` only.
- **The engine is chosen by the file.** `load` is unchanged; the helper loads whichever file it is given, and Spark gives it Parakeet. The host sends `load` only while nothing listens, so a listen keeps the model it started with.

- **Bounded memory.** Samples are never written to disk or sent over the pipe. Each speech segment VAD closes (or cuts at 30 s, whisper's window) is transcribed at once and dropped, so the helper holds one segment (about 2 MB) plus text.
- **Whisper invents text on silence** ("Thank you."): only VAD's speech spans are transcribed, and an empty result shows **Didn't catch that**.
- **Hint** is whisper's initial prompt, built locally from project names, chat titles and ticket prefixes so `spark-outpost` and `CP` are recognised. Parakeet takes no hint; the host still sends it and the helper ignores it.

### When listening ends

| Purpose              | Ends when                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `command`, `confirm` | About 1.5 s of silence after speech (`paused`), or a press                                                    |
| `dictation`          | A press only; it runs through pauses                                                                          |
| All                  | Esc cancels; no speech stops it (3 s for `command` and `confirm`, 30 s for `dictation`); in hold mode, key-up |

## Models

| Model                               | File and size                                         | Languages                                                                      | How                                |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| Silero VAD v6.2.0                   | `ggml-silero-v6.2.0.bin`, 885,098 bytes               |                                                                                | Bundled                            |
| `parakeet-v3`: Parakeet TDT 0.6B v3 | `parakeet-tdt-0.6b-v3-Q5_K_M.gguf`, 548,946,272 bytes | 25: bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro ru sk sl es sv uk | Downloaded when Voice is turned on |

Parakeet is the only speech model. Whisper base (`ggml-base-q5_1.bin`) and Whisper large v3 turbo (`ggml-large-v3-turbo-q5_0.bin`), offered earlier in Phase 2, were removed by the owner's decision, and there is no model choice anywhere.

Pinned sha256 (the Hugging Face LFS oid):

- `ggml-silero-v6.2.0.bin`: `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`
- `parakeet-tdt-0.6b-v3-Q5_K_M.gguf`: `cc722e76adc1a629fc0b2535de879d99b8160d07ad4c0215e2ca7d7ea0ae4b8f`

Pinned URLs, each at a commit, never `main`:

- Parakeet: `https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/85ac09ea12fc4b1112fa76810059364bc6adc9de/parakeet-tdt-0.6b-v3-Q5_K_M.gguf`
- Silero: `ggml-org/whisper-vad` at `9ffd54a1e1ee413ddf265af9913beaf518d1639b`

The manifest is `VOICE_MODELS` in `packages/contracts/src/voice.ts`. Settings → Voice → **Speech model** says: "Understands English and 24 other European languages, and tells them apart on its own." Parakeet measured about 70 ms per short phrase on an M4.

Parakeet English (`parakeet-tdt-0.6b-v2`) is not offered: its GGUF conversion is under the NVIDIA Open Model License, not CC-BY-4.0.

**Retired models.** A saved `model` of `whisper-base` or `whisper-large-v3-turbo`, a missing `model` and an unknown one all read back as `parakeet-v3` without turning Voice off or raising an error (`parseVoiceSettings`). At every desktop start, before anything else, `removeRetiredModels` (`model-store.ts`) deletes `ggml-base-q5_1.bin`, `ggml-large-v3-turbo-q5_0.bin` and the two `<sha256>.partial` files of their downloads from `<userData>/voice/`; it names those four files and nothing else, so the Parakeet file and Silero are never touched.

**Integrity.** Main downloads with Electron `net` to `<userData>/voice/<sha256>.partial`, hashing as it streams; a wrong size or hash deletes it (**The download didn't check out**), otherwise it is renamed to the model's file name. The helper checks the hash again on `load`.

### Downloading

- **State** (`apps/desktop/src/voice/model-store.ts`): missing, downloading (with progress), ready (on disk) or failed (with the reason, a download or a load that failed); `VoiceStatus.models` holds the one model and `VoiceStatus.model` its state. One download at a time: a second request while one runs does nothing.
- **Cancel** aborts the fetch through an `AbortController` and deletes the `.partial`; the model goes back to missing with no problem shown.
- **No Remove and no Select.** Settings shows the **Speech model** card only while Voice is on, so the one model is always the one in use; the card has no Remove, and the IPC has no select or remove call. `turnOn()`, `download()` and `cancelDownload()` take no model.
- **Turn on** saves the switch, asks for the microphone and returns; when the file is missing the download runs in the background, publishing progress, and the model loads when it checks out.
- **At desktop start** with Voice on and the Parakeet file missing (for example a user who had chosen Whisper), the download starts by itself through the same path, with the same integrity checks and progress events. It never starts while Voice is off. A failed download is not retried until the next start or the user's **Download**.
- **A listen with no model** answers `model_missing`. The composer says "Voice doesn't have its speech model yet. Settings → Voice shows its download." and the island says the same; neither surface has a navigation hook for it, so the line is text.

### Bridge

Electron IPC only, never an HTTP route, so paired devices can't reach it; every handler checks the sender. No call names a model, since there is one.

| Channel                 | Preload (`sparkDesktop.speech`) | Does                         |
| ----------------------- | ------------------------------- | ---------------------------- |
| `voice:turn-on`         | `turnOn()`                      | Voice on                     |
| `voice:download`        | `download()`                    | Starts the Parakeet download |
| `voice:cancel-download` | `cancelDownload()`              | Cancels it                   |

Each answers with the new `VoiceStatus`, and `voice:changed` broadcasts every change. With `SPARK_FAKE_VOICE=1` an unpackaged app serves small fake model files (`fake-models.ts`) streamed in steps, with matching hashes, so downloads and cancel run without Hugging Face. `cancelDownload()` answers while the cancel is still settling, so its status may still read downloading; the `voice:changed` that follows carries the missing state.

## Commands and questions

Matching runs locally in TypeScript with a subset of Home Assistant's [hassil](https://github.com/OHF-Voice/hassil/blob/main/docs/template_syntax.md) template syntax: `[optional]`, `(a|b)`, `{list}` slots and a `{text}` wildcard. Spark writes its own templates and borrows no code or sentences. A leading "Spark" is dropped.

| Intent       | Templates (examples)                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `start_chat` | `(start\|new) [a] chat (in\|for) {project} [for [ticket] {ticket}] [to] {text}`; `work on {ticket} in {project} [{text}]` |
| `open`       | `(open\|show [me]\|find) [the] ({chat}\|{ticket}) [chat]`                                                                 |
| `reply`      | `reply to {chat} [saying] {text}`                                                                                         |
| `confirm`    | `(yes\|send [it]\|open it)`, `(no\|cancel)`, only while a voice result is open                                            |

### Slots and fuzzy matching

- **Lists are the user's real names** from the island's query cache: projects (name and folder), chat titles (newest 200) and the Tickets inbox's keys and titles. The matcher never invents one.
- **Normalising:** lower case, filler dropped, number words to digits, spelled letters joined with a sound-alike table (see → C, oh → 0 by digits). "C P four nine zero eight four" becomes `cp49084`, matching `CP-49084`. A key that parses but isn't cached is looked up with the ticket detail route, as typing it would.
- **Scoring:** token-set similarity, Jaro-Winkler per token; a candidate at 0.85 or above and 0.1 ahead of the next is preselected.
- **Ambiguity asks which one:** the top three above 0.6, picked by click, ↑↓ and Enter, or by voice ("the first one"). Nothing above 0.6 says **No project called "…"**.

### Answers

- **Every question** goes into **Ask Spark** as text, sent on the same confirm as a typed question, including questions about Spark (who needs me, what's running, spend, pending tickets, a ticket's status); its session looks things up with the Spark tools (`spark_attention`, `spark_tickets` `list`, `read`, `search`). There are no instant answers: they answered from stale local state, so "What's happening? Anything new?" got "Nothing is running right now." The `open` intent's result card is a command, not an answer, and stays.
- **A spoken question acts as a typed one.** Once the user sends it, what Ask Spark does follows **When Ask Spark acts** (Manual: a card; Act: at once), except that a spoken run gets no Mac control tools (`mac-control/offered.ts`) and never answers an approval card (`ASK_SPARK_REFUSALS.voice` in `spark-mcp/actions/ask-spark-limits.ts`); covered by `ask-spark-acts.db.test.ts`.

## UI flows

1. **Listening:** the island opens with Scout listening, a meter and **Listening… Esc to cancel**, and takes focus. The words heard so far show under it in a muted line, replaced by each `partial`, the end of a long one kept. That line is `aria-hidden`: tentative words every 0.5 s would talk over the user, so only the state line is `aria-live` and the transcript is read on the result. It has no animation.
2. **Working it out** while whisper runs; the transcript then shows above the result.
3. **The result**, focused on its confirm button or text box:

| Intent       | Screen                                                                      | Confirm                  |
| ------------ | --------------------------------------------------------------------------- | ------------------------ |
| `start_chat` | **New chat** with the project chip, a removable ticket chip (new), the task | Enter, Send, or "send"   |
| `open`       | A result card of what was found, the best match preselected                 | Enter, a click, or "yes" |
| `reply`      | **Chats** → the chat → **Reply**, text filled                               | Enter, Send, or "send"   |
| none         | **Ask Spark** with the transcript in the box                                | Enter, Ask, or "send"    |

With a ticket, Send uses the existing ticket start route (`projectId`, `note` = the task) and shows its **Move to In Progress** choice, since that writes to Jira or Linear. **Confirming by voice** needs a fresh press; Spark never listens on its own after a result, and `confirm` is bound to that result's id.

**Speak answers** (off by default) reads aloud Ask Spark's reply as plain text, what an `open` card found ("Found Fix login redirect. Open it?") and **Didn't catch that**, with an installed Apple system voice. Esc or a new press stops it before the mic opens, so Spark never records itself; the mic is not left open to hear the user talk over it.

**Dictation:** a mic button in the chat composer (`Composer.tsx`) and the island's text boxes, with a fixed-size animated listening indicator and screen-reader status; the draft is never sent. In a Terminal session the user sends through the existing `POST /conversations/:id/terminal/message` route, its refusals unchanged (an agent waiting for an answer, a CLI menu, a leading `/` or `!`); a spoken "slash" stays a word. Paired devices use their keyboard's dictation.

**First run:** setup has a **Voice** step after **Mac access**, in the Mac app only (where `desktopSpeech()` exists, and not when the helper is missing). It offers the three models and **Not now**, the recommended one preselected and marked **Recommended for you**, each with its size and language count. The primary button names the size (**Download 549 MB and continue**; **Continue** for **Not now** or a model already on disk), and the footer says macOS asks for the microphone. A model turns Voice on through the same `turnOn` as Settings, without waiting for the download; going back and picking again calls `select`, and **Not now** after that turns Voice off. **Turn on Voice** in Settings, or the first mic press, does the same with the saved model, then **Use Fn twice** (asks for Input Monitoring, or names the Keyboard setting using 🌐 and opens it) or **Use ⌥⇧V**.

**Settings → Voice → Speech model:** one row for Parakeet, with its size from the manifest, a state (**Ready**, **Downloading N%** with a progress bar, **Not downloaded**, or the failure text) and **Download** or **Cancel**; no radios, no list and no Remove. When the Mac's language isn't one Parakeet covers, the card adds one line saying so and that it may transcribe that language poorly. Under it, the credit: Parakeet by NVIDIA, CC BY 4.0, converted to GGUF; downloaded from Hugging Face at a pinned version and checked before use. Setup's **Voice** step offers the Parakeet download (**Download 549 MB and continue**) or **Not now**.

**Live words in dictation:** the composer and the Terminal session's box already preview `partial` text in place, replacing the previous partial, and commit `final` once; they now get partials more often and with tentative words, and nothing is sent until the user sends it.

## Safety

- **Push-to-talk only:** no always-listening, no wake word; the mic is open only with the listening view on screen. The Fn monitor watches modifier changes only, and only when Fn twice is picked.
- **Voice never starts work on its own:** commands open a screen the user confirms, dictation is never sent automatically, and a question is sent only when the user confirms; what Ask Spark then does follows **When Ask Spark acts**.
- **Never by voice:** approval and denial cards, pushes, pull requests, Mac control, Settings, remote control, anything with hold-to-confirm; `confirm` answers only its own voice result.
- **A transcript is the user's message only once the user sends it**; the matcher's choice grants nothing.
- **Paired devices** get no voice: the bridge is Electron IPC, not an HTTP route.
- **Never stored:** audio. Command transcripts stay in memory until the screen closes, unlogged and unaudited.

## What leaves the computer

| What                                 | Where to                                 | When                         |
| ------------------------------------ | ---------------------------------------- | ---------------------------- |
| Audio, spoken answers, key presses   | Nowhere                                  | Never                        |
| A model file request                 | Hugging Face and its CDN                 | Once, for Parakeet           |
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
- **Fresh builds:** `desktop:dev-app` runs whatever is in `apps/web/dist` and `apps/desktop/dist`, so build both from the commit under test first; the 2026-11-12 run found builds from before the change.
- **Speech with no human:** each phrase played with macOS `say` through the speakers into the built-in mic, and as a recorded WAV through the helper's `file` input, so results don't depend on room noise:
  1. "start a chat in orders web app for C P four nine zero eight four add creator email"
  2. "open the dashboards chat"
  3. "what tickets do I have pending"
  4. "who needs me"
  5. a dictated chat message with pauses.

| Check                          | Evidence                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Transcript accurate            | Transcript beside each phrase, `say` and WAV                                           |
| Fuzzy match right              | 1 picks the orders-web-app project and CP-49084; 2 the Dashboards chat                 |
| Prefilled card, nothing starts | Screenshot; no run or message until Enter or "send"                                    |
| Spoken answer plays and stops  | 3 and 4 prefill Ask Spark; once sent, the reply is spoken; Esc and a new press stop it |
| End rules                      | A command ends after about 1.5 s of silence; 5 runs through its pauses until a press   |
| Shortcut                       | Fn twice starts listening; with 🌐 set to Emoji, Spark says why and uses ⌥⇧V           |
| Esc cancels                    | No transcript, no result                                                               |
| Audio never leaves             | `nettop` during a run: no connection but the provider's for a sent message             |
| Browser pane has no mic        | `getUserMedia` on a page in the pane is denied                                         |
| Real Claude, chat              | A dictated message sent in a Spark chat; Claude answers                                |
| Real Claude, Terminal session  | A dictated message reaches a Claude Terminal session through the message route         |
| Ask Spark                      | A spoken free-form question, sent, answered and spoken                                 |

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
- **The shortcut is ⌥⇧V** by default; Phase 2 lets the user record another (see [The shortcut](#the-shortcut)).
- **Protocol:** every message carries `id` and `event`; `load` also takes the bundled VAD path; `stop` and `cancel` name the listen's id; a third `listen` purpose, `confirm`, ends like a command.
- **File input** is accepted only when the host starts the helper with `--allow-file-input`, which only an unpackaged app with `SPARK_VOICE_FILE_INPUT=1` does; that app also exposes `testPress(wav)`, which presses the shortcut with a WAV in place of the mic.
- **Fn twice is offered** when `AppleFnUsageType` in `com.apple.HIToolbox` is 0 and `Dictation Enabled` in `com.apple.assistant.support` is off. An absent `AppleFnUsageType` counts as Emoji (the macOS default). Dictation's own shortcut key is not read, so Dictation on with another shortcut still blocks Fn twice. **Hold to talk** listens while the second Fn press is held.
- **Ticket starts** from a voice chat use the ticket start route with **Move to In Progress** on by default; a spoken `open` of a ticket shows its status in Ask Spark (the island has no ticket page).
- **A phrase that isn't yes, no or a pick** while a result is open is matched as a new command.
- **Partial dictation** appears in the existing input as a local preview, replacing earlier provisional words without saving them. Final text commits once; cancelling restores the committed draft. Editing during speech cancels dictation and keeps the edited text. Sending waits until dictation finishes. A fixed-size waveform replaces the mic while active; reduced motion keeps it static. Errors remain visible.
- **Terminal sessions:** **Dictate** fills a one-line box, sent with **Send to <agent>** through `POST /conversations/:id/terminal/message`, its refusals shown as returned.

### Verified, and not

Project names in these results are replaced with the demo name `orders-web-app`; the recorded run used another project, so this does not show recognition of the phrase as written. On 2026-10-15 (Apple silicon, macOS 26.5, Electron 44.4.5 in the Developer ID signed **Spark Outpost Dev** shell, throwaway data folder, Claude Code CLI signed in): the helper built for arm64 and x64 (minos 12.0, system libraries only) and its Swift tests passed. Through the helper's file input, `say` WAVs gave: 1 "Start a chat and feature, web apps, for CP49084, at Creator Email.", 2 "Open the Dashboards Chat.", 3 "What tickets do I have pending?", 4 "Who needs me?", 5 as a command "please check the login redirect." (`paused` after the first 2 s gap) and as a dictation all three sentences through both pauses (`stopped`). In the app with `testPress`, 1 opened **New chat** with orders-web-app, CP-49084 and the task and started nothing; 2 showed **Found Dashboards** preselected; 3 and 4 answered at once and were spoken; Esc and a new press each stopped a spoken answer; Esc during a listen gave `cancelled` and no result; a spoken free-form question went to Ask Spark, "send it" sent it, real Claude answered in 19 s and the answer was spoken. `nettop` over the session showed no socket for `spark-voice`. With the media guard, `getUserMedia` in the main window and the island rejects with `NotAllowedError` in 0–1 ms (it hung before the guard, because Chromium asks macOS first).

On 2026-10-16, in the same signed **Spark Outpost Dev** shell with Microphone, Input Monitoring and Accessibility granted, through the built-in mic with `say` on the speakers and ⌥⇧V posted as a key event:

| Check                             | Result                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Turn on Voice** downloads       | The pinned URL gave 59,707,625 bytes with sha256 `422f1ae4…a8898` in about 6.5 s; the model loaded                                                                                                                                                                                                                                                                                                 |
| Listening, end rules              | **Listening… Esc to cancel** with a live meter; commands ended `paused` 1.65–1.87 s after `say` finished; a dictation ran through a 2.5 s pause until **Stop dictating**; a listen with no speech ended `silence` at 30.7 s with **Didn’t catch that**; after the 3 s change, a silent command ended `silence` 3.1 s after the mic's first audio (3.7 s after the key press), with the same screen |
| Commands into the mic             | "start a chat in orders web app to add creator email" opened **New chat** with orders-web-app and the task and sent nothing; "open the dashboards chat" (heard "open the Dashboards tab") showed **Found Dashboards** preselected                                                                                                                                                                  |
| Instant answers, spoken           | "what's running" and "what tickets do I have pending" answered at once and were spoken; Esc and a new press each stopped the speech (`interrupted`)                                                                                                                                                                                                                                                |
| Ask Spark                         | A spoken question waited in the box; a spoken "yes" sent it, real Claude answered, and the spoken answer ended 11.5 s after "yes"                                                                                                                                                                                                                                                                  |
| Real Claude, chat and Terminal    | Dictated text filled the chat composer and the Terminal session's box and was not sent; sent, Claude answered in both                                                                                                                                                                                                                                                                              |
| Esc, network, Browser pane        | Esc during a listen gave `cancelled` and no result; `nettop` and `lsof` showed no socket for `spark-voice`; a Browser pane page's `getUserMedia`, and an iframe's, rejected with `NotAllowedError` in 0 ms                                                                                                                                                                                         |
| Short phrases through the speaker | "who needs me" was heard as "Unici", "Unique" and similar in 5 tries, and "send it" as "Sender" and "Semi"; the same phrases as `say` WAVs through the file input were exact, with and without the hint. A one-second pre-roll did not help                                                                                                                                                        |
| Fn twice                          | Not run: this Mac has 🌐 on Show Emoji & Symbols and Dictation on, so Spark named the setting and kept ⌥⇧V, as designed                                                                                                                                                                                                                                                                            |

Still open: Fn twice (it needs **Press 🌐 key to** set to Do Nothing and Dictation off or on another shortcut); ticket matching by voice (no tracker was connected, so phrase 1's CP-49084 was not run); and short phrases spoken into the mic. "who needs me" was never heard right through the speaker, so the spoken instant answer was checked with "what's running". `dev-app.ts` passes `SPARK_VOICE_FILE_INPUT`, so the WAV `testPress` path runs in the signed shell.

The run found that the island kept the project list it loaded at start, so a project linked later was missing from spoken commands and the hint until a restart. A `command` listen now starts at once with the cached hint and fetches the projects alongside; the transcript is matched against the fresh list (or the cached one after 500 ms), so a hold-to-talk release is never held back by the fetch.

On 2026-10-20 (the island inbox change, signed **Spark Outpost Dev** shell, throwaway data folder, microphone and Input Monitoring already granted, 🌐 set to Emoji so the shortcut was ⌥⇧V; no provider signed in): the base model downloaded through **Turn on** and matched its sha256. With `say` WAVs through `testPress`:

- "reply to the deploy the site chat saying ship it after lunch" opened the island's New chat as a follow-up in **Deploy the site** with the draft "ship and after lunch" (one word misheard), and sent nothing.
- "open the dashboards chat" showed **Found Dashboards** waiting for Enter.
- "what tickets do I have pending" and "who needs me" were transcribed exactly, answered at once and spoken. Esc and a new press ("what's running") each stopped a spoken answer (`interrupted: true`).
- Esc during a listen gave `cancelled` and no result.
- The paused phrase ended at its first pause as a command (`paused`) and ran through both pauses as a dictation (`stopped`), with "add a test for it" heard as "at a test rate".
- A start phrase naming a project that didn't exist said so and started nothing, and no chat was created during the run.
- `lsof` showed no socket for `spark-voice`.

Not run that day: Fn twice, the mic through the speakers, the Browser pane's `getUserMedia`, and the real Claude chat, Terminal and Ask Spark sends.

## Phases

1. **Push-to-talk, commands, questions, dictation and spoken answers:** the helper, permissions, the base model, Fn twice and ⌥⇧V, the matcher, island screens, mic buttons, Speak answers with Apple system voices, Settings → **Voice**.
2. **Speech models and live words:** the helper moves from whisper.cpp to transcribe.cpp, which runs Whisper and NVIDIA Parakeet TDT 0.6B v3 from one engine on both arches; Settings and setup first offered Whisper base, Parakeet and Whisper large v3 turbo, then the owner kept Parakeet alone; partials for every purpose. This replaces the earlier plan to run Parakeet through FluidAudio's CoreML conversion on macOS 14+, which would have needed a second engine and left Intel and macOS 12–13 on whisper.cpp.
3. **Better voices:** Kokoro-82M as an optional download only if it runs without espeak-ng (misaki's lexicon alone, unknown words spelled out).

## Decided

By the owner on 2026-10-15: everything in [Safety](#safety), whisper.cpp with Silero VAD, local matching, dictation, the Terminal message route, and no voice on paired phones in v1; **open** shows a result card; Voice **answers questions about Spark**, tickets included, read-only and out loud, in Phase 1; **Fn twice** with ⌥⇧V as the fallback; the **multilingual base** model; **1.5 s of silence** ends a command, not a dictation; the real tests above are required. Rejected: Chromium Web Speech (sends audio to Google), Cactus Whistle (closed engine source), openWakeWord and Porcupine.

By the owner on 2026-10-16: a command (and a `confirm`) in which nothing is said stops after **3 s** from the start of listening, with **Didn’t catch that**; a dictation keeps 30 s; a command still ends about 1.5 s after speech stops.

By the owner on 2026-11-12: Parakeet is the only speech model; Whisper base and Whisper large v3 turbo are removed, there is no model choice, a saved choice of a retired model reads as Parakeet, and the retired files are deleted at start.

Chosen by default: toggle as the model, a download rather than a bundle, ticket starts through the start route.

## Open questions

1. **Parakeet's licence:** settled for the conversion shipped. NVIDIA's v3 card says CC-BY-4.0; the GGUF conversion Spark downloads is attributed in Settings → Voice and in the licence notices. Parakeet English (v2) is left out because its conversion is under the NVIDIA Open Model License.

## Phase 2: speech models and live words

Built: the model manifest (`packages/contracts/src/voice.ts`), the Parakeet download with cancel and the automatic download at start (`model.ts`, `model-store.ts`, `voice.ts`), the IPC above, the fake models, Settings → Voice → **Speech model** (`apps/web/src/settings/SpeechModels.tsx`), setup's **Voice** step (`apps/web/src/onboarding/VoiceStep.tsx`) and live words in the island (`SpeechScreen.tsx`). The Whisper models and the choice between models were removed in a later change; the tests below were recorded while they were offered.

**Helper and build.** `scripts/voice-bundle.ts` builds transcribe.cpp v0.4.1 from its release tarball (sha256 `96a3993c075770bf3ca7aeaa86cc55c3673c24d7176643b60cc6a1f46dcab4a5`) as static libraries with examples, tests, tools and OpenMP off and the deployment target 12.0: Metal with its library embedded on arm64, Metal off and AVX2, FMA and F16C on for x64 (set explicitly, since transcribe.cpp picks its default from the build machine). The build stops if transcribe.cpp's `transcribe-link.json` names a library Spark does not link. Both helpers have minos 12.0 and link only system libraries and frameworks; arm64 grew from 7.1 MB to 8.7 MB, x64 from 2.2 MB to 4.2 MB.

- **One engine, any model:** `Transcriber.swift` loads the file with `transcribe_model_load_file`, which tells GGUF Parakeet from a legacy whisper.cpp `.bin` by its magic, so the Phase 1 `ggml-base-q5_1.bin` and `ggml-silero-v6.2.0.bin` loaded unchanged; Spark now gives it Parakeet and Silero only. `VoiceDetector.swift` runs Silero through transcribe.cpp's streaming VAD on the CPU, one probability per 512-sample frame as before.
- **The hint** goes to a model only when `transcribe_model_supports` reports the initial prompt (Whisper); Parakeet takes none and gets none, so the hint the host builds has no effect today. With the same hint, Whisper's transcripts matched the whisper.cpp helper's word for word on the test WAVs.
- **Language:** a language Parakeet doesn't list, or `auto`, falls back to its own detection.
- **A backend error** in a run reloads the model on the CPU and retries once.
- **Live words:** while speech is open, every 0.5 s of new audio (once the segment is 0.6 s long) the engine decodes the open segment as a draft and emits `partial` with the committed text plus the draft. At most one draft runs, a tick is skipped while one does, none starts once the listen has an end reason, a draft whose segment has closed is dropped, nothing follows `final` or `cancelled`, and repeated text is not re-sent. Drafts skip Whisper's temperature fallback. A draft holds a second copy of the open segment (about 2 MB) while it runs; nothing is written to disk.
- **File input** is now paced in real time, so a `SPARK_VOICE_FILE_INPUT` run lasts as long as the clip and shows the same partials as speech.
- **`load` replaces the loaded model;** the host sends it only while nothing is listening.

### Real tests (Phase 2)

Recorded on 2026-11-02 and 2026-11-03, when the Whisper models were still offered (they were removed later), in the signed **Spark Outpost Dev** shell on an Apple M4 (macOS 26), throwaway data folder, microphone and Input Monitoring granted, 🌐 on Emoji, the WAVs (`say` voices Daniel and Samantha) through `testPress`:

| Test                             | Result                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup's Voice step               | Parakeet preselected; **Download 549 MB and continue** moved on in about 2 s; the download finished in about 15 s with size and sha256 matching                       |
| Parakeet commands, no hint       | "start a chat in spark outpost to fix the login redirect on the settings page" opened New chat with **spark-outpost** and the task, nothing sent; 5 of 6 others exact |
| Live words                       | Parakeet partials from 686 ms ("Start a ch") to 4,240 ms, final at 4,621 ms; about 70 ms a decode                                                                     |
| Whisper base (removed)           | Downloaded and switched by radio; the project name came through thanks to the hint                                                                                    |
| Whisper large v3 turbo (removed) | Cancel at 9% left no file; download and switch about 15 s, sha256 matching; fewer partials, as expected                                                               |
| Switch during a listen           | The running listen finished on the old model; the next used the new one                                                                                               |
| Network                          | `lsof` showed no sockets for `spark-voice`                                                                                                                            |
| Own shortcut                     | ⌃⌥M recorded through IPC, posted as a key event: listening started and ⌥⇧V did nothing; Reset bound ⌥⇧V again; Quick chat's keys and a bare letter refused            |
| Microphone                       | The owner spoke commands and dictation through the built-in mic with Parakeet: working                                                                                |

Not run: Intel (no Rosetta run of the x64 helper), Metal on macOS 12, and the CPU fallback after a Metal failure.

### Real tests (Parakeet only)

Recorded on 2026-11-12 at commit `6feeb8b`, after Whisper base and Whisper large v3 turbo were removed, in the signed **Spark Outpost Dev** shell on a Mac mini (Mac16,10, Apple M4, 16 GB, macOS 26.5.2), a new throwaway data folder for each scenario, microphone and Input Monitoring already granted to Spark Outpost Dev, `say` WAVs through the helper's file input and `testPress`, with `--debug` to drive the app. `pnpm desktop:voice --test` passed. `apps/web/dist` and `apps/desktop/dist` were rebuilt first: `desktop:dev-app` otherwise ran builds from before the change.

| Test                   | Result                                                                                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup's Voice step     | Only Parakeet (549 MB, 25 languages) and **Not now**; **Download 549 MB and continue** moved on at once; the download finished in about 14 s, 548,946,272 bytes, sha256 matching the manifest                                      |
| Settings → Voice       | One Parakeet row reading **Ready**, no radios, no Remove                                                                                                                                                                           |
| Coming from Whisper    | Voice on with `model: "whisper-base"`: both retired files and both retired `.partial` files deleted at start, Silero untouched (same sha256 and mtime), Parakeet downloading by itself within 1 s and done in about 16 s           |
| Voice off, no model    | Watched 2 min 7 s: no `voice/` folder, no `.gguf` or `.partial`, no Hugging Face connection                                                                                                                                        |
| No model yet           | Composer at 40% of the download: "Voice doesn't have its speech model yet. Settings → Voice shows its download." The island showed the same once its press registered (see below)                                                  |
| Commands               | "start a chat in spark outpost for C P four nine zero eight four to fix the login redirect" heard as "…for CP49084…", opened New chat with spark-outpost, CP-49084 and the task, nothing sent; "open the dashboards chat" found it |
| Dictation              | A WAV with two 2.5 s pauses came through exact; through the mic with `say` on the speakers a few words were misheard                                                                                                               |
| Live words             | First partial 0.65–1.09 s after speech starts, then about every 0.4–0.6 s; the final at most 0.1 s after the clip ends; a decode at most about 100 ms, inferred from timing                                                        |
| Nothing leaves the Mac | `lsof` on `spark-voice` during listens: 0 internet sockets in 5 samples; `nettop` showed no `spark-voice` rows                                                                                                                     |
| Language note          | Launched with `-AppleLanguages "(ja)"`: "Parakeet doesn't cover Japanese, your Mac's language, and may transcribe it poorly."                                                                                                      |

Found by the run and still open: the island ignored a Voice press in its first seconds after launch (one about 10 s in worked; not checked whether this predates the change), and `voice-settings.json` keeps `"whisper-base"` on disk until the next save, read as Parakeet. Not run: the x64 helper, and Fn twice (🌐 is set to Emoji on this Mac).

## Licences

Read 2026-10-15; Phase 2 rows read 2026-11-02. Notices for the speech engine, the weights and Silero ship in `Contents/Resources/voice/licenses/`, as tmux's do; Apple system voices are part of macOS. Settings → Voice credits Parakeet (NVIDIA, CC BY 4.0, converted to GGUF) under the **Speech model** card. Whisper models are no longer offered or downloaded; their weights row stays because the notice still ships in the bundle.

| Component                                 | Licence                                    | Source                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| transcribe.cpp                            | MIT; its third-party list (ggml, miniz)    | [handy-computer/transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) v0.4.1, `LICENSE` and `THIRD-PARTY-LICENSES.md` shipped                      |
| tinyBLAS                                  | MIT (Mozilla Foundation)                   | Compiled into transcribe.cpp's ggml, missing from its list; notice shipped                                                                                     |
| whisper.cpp (Phase 1 only)                | MIT                                        | [ggml-org/whisper.cpp LICENSE](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)                                                                    |
| Whisper weights (ggml, no longer offered) | MIT                                        | [openai/whisper LICENSE](https://github.com/openai/whisper/blob/main/LICENSE), [ggerganov/whisper.cpp card](https://huggingface.co/ggerganov/whisper.cpp)      |
| Silero VAD                                | MIT                                        | [snakers4/silero-vad LICENSE](https://github.com/snakers4/silero-vad/blob/master/LICENSE), [ggml-org/whisper-vad](https://huggingface.co/ggml-org/whisper-vad) |
| hassil (syntax only)                      | Apache-2.0                                 | [OHF-Voice/hassil LICENSE](https://github.com/OHF-Voice/hassil/blob/main/LICENSE.md)                                                                           |
| Kokoro-82M (Phase 2)                      | Apache-2.0                                 | [hexgrad/Kokoro-82M card](https://huggingface.co/hexgrad/Kokoro-82M)                                                                                           |
| misaki (Kokoro's G2P)                     | Apache-2.0; falls back to espeak-ng        | [hexgrad/misaki](https://github.com/hexgrad/misaki)                                                                                                            |
| espeak-ng (not used)                      | GPL-3.0                                    | [espeak-ng/espeak-ng](https://github.com/espeak-ng/espeak-ng)                                                                                                  |
| Parakeet TDT 0.6B v3                      | CC-BY-4.0                                  | [nvidia/parakeet-tdt-0.6b-v3 card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)                                                                         |
| Parakeet v3 GGUF                          | CC-BY-4.0 (NVIDIA's weights, converted)    | [handy-computer/parakeet-tdt-0.6b-v3-gguf](https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf) at `85ac09ea12fc4b1112fa76810059364bc6adc9de`      |
| Parakeet English (not used)               | NVIDIA Open Model License (its conversion) | Left out for its licence                                                                                                                                       |
| FluidAudio (not used)                     | Apache-2.0 code; macOS 14+                 | [FluidInference/FluidAudio](https://github.com/FluidInference/FluidAudio)                                                                                      |
| openWakeWord (not used)                   | Apache-2.0 code, models CC BY-NC-SA 4.0    | [dscripka/openWakeWord README](https://github.com/dscripka/openWakeWord#license)                                                                               |
| Porcupine (not used)                      | Needs a Picovoice Console AccessKey        | [Picovoice/porcupine README](https://github.com/Picovoice/porcupine)                                                                                           |
