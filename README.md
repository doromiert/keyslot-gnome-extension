# Keyslot Quick Settings

Companion extension for GNOME Shell 50. Adds a Keyslot tile in the system's
Quick Settings menu. Clicking an unlocked tile locks all databases; clicking a
locked tile opens the application. The submenu provides explicit Open and Lock
actions and the Auto-Type chooser. The Lock All action also cancels an in-progress unlock or other work.
Installing this extension does not enable it.

Version4/package0.4.0 adds a compact Shell approval dialog for browser password
access. With a matching Keyslot app, this avoids opening its main window and
works independently of notification DND. It shows connection/website/form and
entry display metadata, never secret values. Allow Selected, Deny, Remember This
Decision and Fully Trust This Browser match the app's access controls. Trust is
stored in the encrypted database by the app's native helper and can be removed
under Database Settings → Browser Connections. It bypasses repeated matching
login/HTTP-auth prompts; hidden/denied/recycled/expired entries and connection
restrictions still apply. Saves, deletes, pairing, unlock and passkey ceremonies
retain their application dialogs. The app falls back to GTK when this interface
is absent, not when the user cancels it.

The exported Browser1 interface accepts only the app's current unique bus owner.
Owner loss, lock, disable, explicit cancellation and a25-second deadline remove
the prompt immediately. One prompt is active at a time; Escape denies. DND is
not modified. This update has package/schema compilation, JavaScript syntax and
static source evidence only. No tests/harnesses or Shell/browser/GTK/vault runs
were performed. Actual approval, DND, cancellation, trust and accessibility
acceptance remains manual; updating the package does not reload the extension.

The application is a separate package, `com.neg-zero.keyslot`. The extension
does not receive vault credentials or unlock keys. The
application session-bus API exposes `Locked`, `Busy`, `Background`, `Show`, `Lock`, `Quit`, and `AutoType`. Unlocking
always happens in the application's window. It is disabled on the lock screen.
Locked is true only when every database window is locked; Busy covers every window.

By default, Ctrl+Alt+K opens Auto-Type. On Wayland, an additional interface supplies the
destination window title and a temporary focus lease only to Keyslot's current
bus owner. Switching windows revokes that lease, even if focus returns later.
The application requests keyboard access through the desktop portal; the
extension does not accept keystrokes or secret fields. The shortcut is stored
in `org.gnome.shell.extensions.keyslot` → `auto-type`.

Version3/package0.3.0 adds GTK4/libadwaita preferences for that setting. GNOME
Extensions → Keyslot → Settings, or Desktop Auto-Type Shortcuts in Keyslot,
opens the editor. Add/change/remove aliases, remove all to disable, or reset to
the default. Read-only desktop policy is respected; existing unsupported values
are preserved until explicitly changed/removed. New aliases are checked for
own-list duplicates; conflicts with other desktop actions are not enumerated.
Detected intervening settings changes are refused before writing (GSettings
has no atomic compare-and-swap here). Changes use the live Shell binding.

The recorder requests Gdk toplevel shortcut inhibition, waits for compositor
confirmation, and restores shortcuts on close/save/cancel. Cancel or Escape
leaves the setting unchanged. If the desktop denies capture, cancel the recorder.
The global hotkey also refuses to invoke Auto-Type into GNOME extension
preferences: a no-auto-start D-Bus owner/PID check, with focus-generation and
request-serial guards, cancels on unknown metadata/service errors/focus changes.
This protects the recorder while inhibition is pending or revoked and applies
conservatively to all GNOME extension preferences windows. The extension sends
no credential/keystroke payload. Install/upgrade does not reload an already
running extension; the user must load version3 before trying the new recorder.

This update has package/schema compilation and JavaScript syntax-only evidence.
No tests/harnesses or automated preferences/Shell/GTK/shortcut/focus/settings/
vault/typing behavior runs were added/performed. Actual GNOME50/X11/Wayland
recording, grant/denial/revocation, modifier/layout/alias handling, readonly/
concurrent writes, service/focus/disable lifecycle and accessibility remain
manual acceptance. Historical results below concern an earlier checkpoint.

Version2/package0.2.0 also supports Keyslot's Lower Behind Other Windows copy
preference. `AutoType1.Lower(s window_path) → b` accepts only the current Keyslot
bus owner and the currently focused Keyslot compositor window, matching both
its GTK unique bus name and window object path to the caller/request. The lock
screen, overview, override-redirect windows, missing compositor actors and
pending Auto-Type focus requests are rejected. Only that window is lowered; no
other app is activated,
and no entry data, clipboard text or keystrokes cross this call. The app handles
an old/absent/disabled companion without a silent minimize fallback. Installing
the package does not enable or reload it. This method has compilation/package
and JavaScript syntax-only evidence; real Shell/X11/Wayland/focus/lifecycle
acceptance is pending. No tests/harnesses or automated behavior runs were added
or performed for this update; the historical results below cover the earlier
extension checkpoint.

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

The runner requires GNOME Shell 50, GJS/GTK4, GLib schema tools, D-Bus, and a built app. It creates isolated
config/data/runtime directories and a private bus. A real login/lock-screen and
other extensions' interaction still need manual acceptance.

The hosted source is `doromiert/keyslot-gnome-extension`. ZenPkgs packages it
separately as `desktops.gnome.extensions.keyslot`; the app is
`apps.security.keyslot` from `zenos-n/keyslot`.

License: GPL-3.0-only. See `LICENSE`.
