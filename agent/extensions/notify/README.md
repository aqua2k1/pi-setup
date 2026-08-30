# Pi desktop notifications

This extension exposes one shared API for native desktop popups:

```ts
import { notify } from "./agent/extensions/notify/index.ts";

notify("Build", "The build finished.");
```

`notify(title, msg)` is Pi-independent, so other extensions can import it and
use the same notification implementation as this extension. It returns `true`
when the platform process was accepted for execution. Delivery is best-effort;
a missing dependency or operating-system failure never affects Pi.

## Architecture

- `index.ts` exports `notify(title, msg)` and contains the Pi lifecycle adapter.
- `core.ts` detects the platform and launches the appropriate adapter without a
  shell.
- `scripts/` contains the platform-specific popup implementations. Unix
  adapters receive title and message as positional arguments; the PowerShell
  adapter receives them as `-Title` and `-Message` parameters.

The internal completion handler uses the same API:

```ts
notify("Pi", "Task completed.");
```

It runs only in Pi's TUI mode after `agent_settled` has remained idle for one
second. Pending notifications are cancelled when new input or a new run starts.
Every notification is limited to one minute. The operating system may dismiss
it sooner, but the adapter never intentionally leaves it visible longer. The
adapters use stable replacement identifiers so a later notification from this
transport replaces the previous one.

## Platform adapters

| Environment | Adapter | Dependency | Behavior |
| --- | --- | --- | --- |
| Windows / WSL2 | `scripts/windows-toast.ps1` | Windows PowerShell | Toast expires after one minute. |
| Linux | `scripts/linux-notify.sh` | `notify-send` / libnotify | Expires after 60 seconds and replaces the previous notification. |
| macOS | `scripts/macos-notify.sh` | [`terminal-notifier`](https://github.com/julienXX/terminal-notifier) | Removes the grouped notification after 60 seconds. |

WSL2 uses the Windows adapter through WSL interop. It does not depend on a
specific terminal emulator. Native Linux and macOS do not depend on a terminal
emulator.

Install dependencies when needed:

```bash
brew install terminal-notifier
sudo apt install libnotify-bin
```

Install the extension globally at:

```text
~/.pi/agent/extensions/notify/
```

After changing the extension or scripts, run `/reload` in Pi.

## Development and tests

```bash
npm test
# or from the repository root:
npm --prefix agent/extensions/notify test
```
