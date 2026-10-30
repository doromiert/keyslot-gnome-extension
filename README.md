# Keyslot Quick Settings

Companion extension for GNOME Shell 50. Adds a Keyslot tile in the system's
Quick Settings menu. Clicking an unlocked tile locks all databases; clicking a
locked tile opens the application. The submenu provides explicit Open and Lock
actions. The Lock All action also cancels an in-progress unlock or other work.
Installing this extension does not enable it.

The application is a separate package, `com.neg-zero.keyslot`. The extension
does not receive filenames, entry names, credentials, or unlock keys. The
session-bus API exposes only `Locked`, `Busy`, `Background`, `Show`, `Lock`, and `Quit`. Unlocking
always happens in the application's window. It is disabled on the lock screen.
Locked is true only when every database window is locked; Busy covers every window.

With the app's Run in Background option enabled, this extension also adds the
native app to GNOME's existing Background Apps menu. The row shows only generic
lock status; clicking it opens Keyslot and its close button quits safely. Closing
a Keyslot window returns it to background mode. Disabling the extension restores
GNOME's original methods and removes the row. The extension uses GNOME 50's
InjectionManager for reversible method overrides; it preserves the portal's rows
and avoids duplicates if the portal already lists Keyslot.

The installed portal 1.20.4 [only monitors Flatpak instances](https://github.com/flatpak/xdg-desktop-portal/blob/1.20.4/src/background.c#L328)
and rejects SetStatus from host applications. Calling RequestBackground alone
cannot put a native ZenPkgs app in that list. This companion supplies the native
row using the existing GNOME menu, without changing the portal or system packages.

Install the application first, then:

```sh
gnome-extensions pack . --extra-source=LICENSE --out-dir=/tmp --force
gnome-extensions install /tmp/keyslot@neg-zero.shell-extension.zip
gnome-extensions enable keyslot@neg-zero
```

A logout/login may be required after first installation. For Nix, the separate
package installs into `share/gnome-shell/extensions/keyslot@neg-zero`; enable
it with GNOME Extensions or the existing ZenOS per-user extension controls.

Verified in a disposable real GNOME Shell 50.4 session: extension enable, native
Background Apps row/status, repeated-update deduplication, Open, window close,
Quit, and disable cleanup. To repeat without changing your desktop:

```sh
python3 tools/check-shell.py --app /path/to/keyslot/bin/keyslot
```

The runner requires GNOME Shell 50, D-Bus, and a built app. It creates isolated
config/data/runtime directories and a private bus. A real login/lock-screen and
other extensions' interaction still need manual acceptance.

The source has not been published to a remote repository. ZenPkgs currently
uses this sibling checkout as a development input.

License: GPL-3.0-only. See `LICENSE`.
