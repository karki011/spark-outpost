# Windows helper

`spark-win-helper.exe` is the one native helper on Windows (see "One Windows helper" in `WINDOWS_PLAN.md`). Today it does one thing: Windows Hello for the privacy screen. Voice and UI Automation are planned and will add ops to the same protocol.

## Build

- Source: `apps/desktop/native/win-helper/` (`src/` is the helper, `tests/` the xunit tests over a fake verifier).
- C#, `net8.0`, published with Native AOT for `win-x64`: one self-contained exe, no .NET install needed to run it. arm64 comes later.
- `pnpm desktop:win-helper` publishes it into `.local/win-helper/x64/` and, on an x64 machine, asks the built exe for `status` and `hello.available`. `--test` runs `dotnet test` first. It needs Windows and the .NET 8 SDK or newer, and refuses with a clear message elsewhere (Native AOT doesn't cross-compile).
- `pnpm desktop:package --platform win` copies the built exe to `resources/win-helper/`. A local build without it prints a note and ships without Windows Hello.
- The Windows workflow (`.github/workflows/windows.yml`) builds and tests it in the installer job before packaging. The installer smoke test checks that the installed exe answers `status` and `hello.available`.
- Not signed yet: it is signed with the app once Windows signing exists (`RELEASES.md`).

## Protocol

Newline-delimited JSON on stdin and stdout, one request and one answer per line, like the Mac helpers. The app starts it with an environment holding only `SystemRoot` and `windir`, which WinRT activation needs.

| Op                | Request                                                             | Result                                                         |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `status`          | `{id, op}`                                                          | `{protocol: 1}`                                                |
| `hello.available` | `{id, op}`                                                          | `{available}`: true only when Windows says `Available`         |
| `hello.verify`    | `{id, op, message, window}`, `window` a decimal HWND string or null | `{outcome}`: `verified`, `cancelled`, `unavailable` or `error` |

An answer is `{id, ok: true, result}` or `{id, ok: false, code, message}` (`invalid`, `unknown-op`, `failed`; `id` is null when the line had none). The host (`apps/desktop/src/win-helper/`) refuses a helper whose `protocol` isn't 1, restarts one that stays silent for 10 s on a quick op, and never times out `hello.verify`, whose dialog waits for the user.

## Windows Hello

- `hello.available` calls `UserConsentVerifier.CheckAvailabilityAsync`. `hello.verify` calls `IUserConsentVerifierInterop.RequestVerificationForWindowAsync` with the HWND of the window that asked (from `BrowserWindow.getNativeWindowHandle()`), so the dialog is owned by Spark's window and comes up in front of it. Without a window, or without the interop interface, it calls `RequestVerificationAsync`.
- The WinRT calls are made through the activation factory's vtables with function pointers, not through CsWinRT projections or `[ComImport]`, so the exe stays AOT-clean. The IID of `IAsyncOperation<UserConsentVerificationResult>` is a constant checked against its WinRT signature in the tests.
- Windows shows its own dialog (face, fingerprint or Hello PIN). The helper returns only the outcome: no biometric data, no PIN and no Windows password ever reaches it or Spark.
- Mapping: `Verified` is verified; `Canceled` is cancelled; `DeviceNotPresent`, `NotConfiguredForUser` and `DisabledByPolicy` are unavailable; `DeviceBusy`, `RetriesExhausted` and anything else are error.

## In the app

`apps/desktop/src/windows-hello.ts` and `app-lock-host.ts` on win32:

- Availability is asked at start and whenever a window reads the lock status, and kept in memory; a change is broadcast. It fills `touchIdAvailable` and `recoveryAvailable`, and the page names it **Windows Hello** on Windows.
- Unlock: the **Unlock with Windows Hello** setting (stored as `touchId`) and Hello available. A cancelled or failed dialog leaves Spark locked, and counts as no wrong code.
- **Forgot code?**: shown only while Hello is available; a verified answer removes the code and turns the privacy screen off, as the Mac's owner check does.
- With the helper missing (logged once with how to build it), a protocol mismatch or Hello not set up, the code is the only way in and **Forgot code?** is hidden.

## Unverified

The real Windows Hello dialog hasn't been run on hardware with Hello set up. CI runs the protocol tests, builds the AOT exe and calls `CheckAvailabilityAsync` for real on the runner (which has no Hello, so it answers unavailable). The window interop path, the dialog's focus and a verified answer are untested.
