// SPDX-License-Identifier: GPL-3.0-only
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {ngettext} from 'gettext';

import {Extension, InjectionManager, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {BrowserApprovals} from './browserApproval.js';

const BUS_NAME = 'com.neg-zero.keyslot';
const OBJECT_PATH = '/com/neg_zero/keyslot/Vault1';
const INTERFACE = 'com.neg_zero.keyslot.Vault1';
const INTERFACE_XML = `<node><interface name="${INTERFACE}">
  <method name="Show"/><method name="Lock"/><method name="Quit"/><method name="AutoType"/>
  <property name="Locked" type="b" access="read"/>
  <property name="Busy" type="b" access="read"/>
  <property name="Background" type="b" access="read"/>
</interface></node>`;
const VaultProxy = Gio.DBusProxy.makeProxyWrapper(INTERFACE_XML);

// Only window metadata crosses this interface. Keyboard access goes through the desktop portal.
const TARGET_XML = `<node><interface name="com.neg_zero.keyslot.AutoType1">
  <method name="Capture"><arg type="s" direction="out"/><arg type="s" direction="out"/></method>
  <method name="Focus"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
  <method name="Check"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
  <method name="Lower"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
</interface></node>`;

class AutoTypeTarget {
    constructor(owner) {
        this._owner = owner;
        this._lease = null;
        this._previous = null;
        this._source = 0;
        this._pending = null;
        this._focusId = global.display.connect('notify::focus-window', () => this._changed());
        this._changed();
        this._object = Gio.DBusExportedObject.wrapJSObject(TARGET_XML, this);
        this._object.export(Gio.DBus.session, '/com/neg_zero/keyslot/AutoType1');
    }

    _changed() {
        const window = global.display.focus_window;
        if (this._lease?.armed && window !== this._lease.window)
            this._lease = null;
        if (window && !this._isKeyslot(window) && !window.is_override_redirect())
            this._previous = window;
    }

    _isKeyslot(window) {
        return window.get_gtk_application_id() === BUS_NAME
            || Shell.WindowTracker.get_default().get_window_app(window)?.get_id() === `${BUS_NAME}.desktop`;
    }

    _authorized(invocation) {
        if (this._owner() && invocation.get_sender() === this._owner())
            return true;
        invocation.return_dbus_error('org.freedesktop.DBus.Error.AccessDenied', 'Only Keyslot may use this interface');
        return false;
    }

    _valid(token) {
        const lease = this._lease;
        return Boolean(lease && lease.token === token && lease.owner === this._owner()
            && GLib.get_monotonic_time() < lease.expires && !Main.sessionMode.isLocked
            && lease.window.get_compositor_private() && !this._isKeyslot(lease.window));
    }

    CaptureAsync(_parameters, invocation) {
        if (!this._authorized(invocation))
            return;
        const focused = global.display.focus_window;
        const window = focused && !this._isKeyslot(focused) ? focused : this._previous;
        this._lease = null;
        if (!window || !window.get_compositor_private() || this._isKeyslot(window) || Main.sessionMode.isLocked) {
            invocation.return_value(new GLib.Variant('(ss)', ['', '']));
            return;
        }
        const token = GLib.uuid_string_random();
        this._lease = {token, window, armed: false, owner: this._owner(),
            expires: GLib.get_monotonic_time() + 240 * GLib.USEC_PER_SEC};
        invocation.return_value(new GLib.Variant('(ss)', [token, window.get_title() ?? 'Untitled Window']));
    }

    FocusAsync([token], invocation) {
        if (!this._authorized(invocation))
            return;
        if (!this._valid(token) || this._pending) {
            invocation.return_value(new GLib.Variant('(b)', [false]));
            return;
        }
        Main.activateWindow(this._lease.window);
        this._pending = invocation;
        const end = GLib.get_monotonic_time() + GLib.USEC_PER_SEC;
        this._source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 25, () => {
            const active = this._valid(token) && global.display.focus_window === this._lease.window;
            if (!active && this._valid(token) && GLib.get_monotonic_time() < end)
                return GLib.SOURCE_CONTINUE;
            if (active)
                this._lease.armed = true;
            this._pending.return_value(new GLib.Variant('(b)', [Boolean(active)]));
            this._pending = null;
            this._source = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    CheckAsync([token], invocation) {
        if (this._authorized(invocation))
            invocation.return_value(new GLib.Variant('(b)', [Boolean(this._valid(token)
                && this._lease.armed && global.display.focus_window === this._lease.window
                && !Main.overview.visible)]));
    }

    LowerAsync([path], invocation) {
        if (!this._authorized(invocation))
            return;
        const window = global.display.focus_window;
        const allowed = Boolean(window && path && this._isKeyslot(window)
            && window.get_gtk_unique_bus_name() === invocation.get_sender()
            && window.get_gtk_window_object_path() === path
            && window.get_compositor_private() && !window.is_override_redirect()
            && !Main.sessionMode.isLocked && !Main.overview.visible && !this._pending);
        if (allowed)
            window.lower();
        invocation.return_value(new GLib.Variant('(b)', [allowed]));
    }

    destroy() {
        if (this._source)
            GLib.source_remove(this._source);
        this._pending?.return_value(new GLib.Variant('(b)', [false]));
        this._pending = null;
        this._lease = this._previous = null;
        global.display.disconnect(this._focusId);
        this._object.unexport();
    }
}

const VaultToggle = GObject.registerClass(
class VaultToggle extends QuickSettings.QuickMenuToggle {
    constructor() {
        super({
            title: _('Keyslot'),
            subtitle: _('Not Running'),
            iconName: 'dialog-password-symbolic',
            toggleMode: true,
        });
        this._disposed = false;
        this._cancellable = new Gio.Cancellable();
        this._installBackgroundIntegration();
        this.menu.setHeader('dialog-password-symbolic', _('Keyslot'), _('Password Manager'));
        this.menu.addAction(_('Open Keyslot'), () => this._call('Show'));
        this.menu.addAction(_('Auto-Type…'), () => this._call('AutoType'));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._lockAction = this.menu.addAction(_('Lock All Databases'), () => this._call('Lock'));
        this._proxy = new VaultProxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH,
            (proxy, error) => {
                if (this._disposed)
                    return;
                if (!error) {
                    this._proxy = proxy;
                    this._propertiesId = proxy.connect('g-properties-changed', () => this._sync());
                    this._ownerId = proxy.connect('notify::g-name-owner', () => this._sync());
                }
                this._sync();
            }, this._cancellable, Gio.DBusProxyFlags.DO_NOT_AUTO_START);
        this.connect('clicked', () => {
            const unlocked = this._proxy?.g_name_owner && this._proxy.Locked === false;
            this._sync();
            this._call(unlocked ? 'Lock' : 'Show');
        });
        this._sync();
    }

    _sync() {
        if (this._disposed)
            return;
        const running = Boolean(this._proxy?.g_name_owner);
        const unlocked = running && this._proxy.Locked === false;
        this.checked = unlocked;
        this.subtitle = !running ? _('Not Running')
            : this._proxy.Busy ? _('Working…') : unlocked ? _('Unlocked') : _('Locked');
        this._lockAction.sensitive = unlocked || (running && Boolean(this._proxy.Busy));
        this._backgroundToggle?._sync();
    }

    _installBackgroundIntegration() {
        // GNOME's portal monitor currently lists Flatpak instances only.
        this._backgroundToggle = Main.panel.statusArea.quickSettings._backgroundApps?.quickSettingsItems[0];
        if (!this._backgroundToggle)
            return;
        const owner = this;
        this._injections = new InjectionManager();
        const prototype = Object.getPrototypeOf(this._backgroundToggle);
        this._injections.overrideMethod(prototype, '_syncVisibility', original => function (...args) {
            original.apply(this, args);
            if (owner._nativeBackground() && !Main.sessionMode.isLocked)
                this.visible = true;
        });
        this._injections.overrideMethod(prototype, '_sync', original => function (...args) {
            this._keyslotItem?.destroy();
            this._keyslotItem = null;
            original.apply(this, args);
            if (!owner._nativeBackground()) {
                if (!this._proxy) {
                    this.title = _('No Background Apps');
                    this._listTitle.visible = false;
                }
                return;
            }
            const alreadyListed = this._proxy?.BackgroundApps?.some(item => item.app_id.deepUnpack() === BUS_NAME);
            if (alreadyListed)
                return;
            const item = new PopupMenu.PopupImageMenuItem(_('Keyslot'), 'keepassxc');
            item.add_style_class_name('background-app-item');
            item.label.add_style_class_name('title');
            const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
                x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER});
            item.remove_child(item.label);
            box.add_child(item.label);
            box.add_child(new St.Label({text: owner._proxy.Busy ? _('Working…')
                : owner._proxy.Locked ? _('Vaults Locked') : _('Vaults Unlocked'),
            style_class: 'subtitle'}));
            item.add_child(box);
            const close = new St.Button({icon_name: 'window-close-symbolic', style_class: 'icon-button',
                x_expand: true, x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER,
                accessible_name: _('Quit Keyslot')});
            close.connect('clicked', () => owner._call('Quit'));
            item.add_child(close);
            item.connect('activate', () => owner._call('Show'));
            this._appsSection.addMenuItem(item);
            this._keyslotItem = item;
            const count = this._appsSection._getMenuItems().length;
            this.title = ngettext('%d Background App', '%d Background Apps', count).format(count);
            this._listTitle.visible = true;
            this._syncVisibility();
        });
    }

    _nativeBackground() {
        return !this._disposed && Boolean(this._proxy?.g_name_owner && this._proxy.Background);
    }

    _call(method) {
        if ((method === 'Lock' || method === 'Quit') && !this._proxy?.g_name_owner)
            return;
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, INTERFACE, method, null,
            null, Gio.DBusCallFlags.NONE, 10000, this._cancellable,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                } catch (error) {
                    if (!this._disposed && !error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        Main.notify(_('Keyslot'), _('Could not reach Keyslot. Check that the application is installed.'));
                }
                if (!this._disposed)
                    this._sync();
            });
        Main.panel.statusArea.quickSettings.menu.close();
    }

    destroy() {
        this._disposed = true;
        this._injections?.clear();
        this._backgroundToggle?._keyslotItem?.destroy();
        if (this._backgroundToggle)
            this._backgroundToggle._keyslotItem = null;
        this._backgroundToggle?._sync();
        this._backgroundToggle = null;
        this._cancellable.cancel();
        if (this._propertiesId)
            this._proxy.disconnect(this._propertiesId);
        if (this._ownerId)
            this._proxy.disconnect(this._ownerId);
        this._proxy?.run_dispose();
        this._proxy = null;
        super.destroy();
    }
});

const VaultIndicator = GObject.registerClass(
class VaultIndicator extends QuickSettings.SystemIndicator {
    constructor() {
        super();
        this.quickSettingsItems.push(new VaultToggle());
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class KeyslotExtension extends Extension {
    enable() {
        this._shortcutSerial = (this._shortcutSerial ?? 0) + 1;
        this._shortcutCancellable = new Gio.Cancellable();
        this._shortcutFocusId = global.display.connect('notify::focus-window', () => this._shortcutSerial++);
        this._indicator = new VaultIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        this._target = new AutoTypeTarget(() => this._indicator?.quickSettingsItems[0]?._proxy?.g_name_owner);
        this._browserApprovals = new BrowserApprovals(() => this._indicator?.quickSettingsItems[0]?._proxy?.g_name_owner);
        this._settings = this.getSettings();
        Main.wm.addKeybinding('auto-type', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL, () => this._autoTypeShortcut());
    }

    _autoTypeShortcut() {
        const focused = global.display.focus_window;
        const serial = ++this._shortcutSerial;
        if (!focused || Main.sessionMode.isLocked)
            return;
        const current = () => this._indicator && serial === this._shortcutSerial &&
            global.display.focus_window === focused && !Main.sessionMode.isLocked;
        const invoke = () => {
            if (current())
                this._indicator.quickSettingsItems[0]._call('AutoType');
        };
        // The recorder must never become an Auto-Type destination, including while inhibition is pending.
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'NameHasOwner', new GLib.Variant('(s)', ['org.gnome.Shell.Extensions']),
            new GLib.VariantType('(b)'), Gio.DBusCallFlags.NO_AUTO_START, 1000, this._shortcutCancellable,
            (connection, result) => {
                try {
                    const [running] = connection.call_finish(result).deep_unpack();
                    if (!current())
                        return;
                    if (!running) {
                        invoke();
                        return;
                    }
                    connection.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                        'GetConnectionUnixProcessID', new GLib.Variant('(s)', ['org.gnome.Shell.Extensions']),
                        new GLib.VariantType('(u)'), Gio.DBusCallFlags.NO_AUTO_START, 1000, this._shortcutCancellable,
                        (bus, reply) => {
                            try {
                                const [preferencesPid] = bus.call_finish(reply).deep_unpack();
                                const pid = focused.get_pid();
                                if (current() && pid > 0 && pid !== preferencesPid)
                                    invoke();
                            } catch {
                                // Failed owner/focus metadata cancels this invocation; no delayed replay.
                            }
                        });
                } catch {
                    // Do not start Auto-Type when recorder ownership cannot be established.
                }
            });
    }

    disable() {
        this._browserApprovals?.destroy();
        this._browserApprovals = null;
        this._shortcutSerial++;
        this._shortcutCancellable?.cancel();
        this._shortcutCancellable = null;
        if (this._shortcutFocusId)
            global.display.disconnect(this._shortcutFocusId);
        this._shortcutFocusId = 0;
        Main.wm.removeKeybinding('auto-type');
        this._settings = null;
        this._target?.destroy();
        this._target = null;
        this._indicator?.destroy();
        this._indicator = null;
    }
}
