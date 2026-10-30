// SPDX-License-Identifier: GPL-3.0-only
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {ngettext} from 'gettext';

import {Extension, InjectionManager, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

const BUS_NAME = 'com.neg-zero.keyslot';
const OBJECT_PATH = '/com/neg_zero/keyslot/Vault1';
const INTERFACE = 'com.neg_zero.keyslot.Vault1';
const INTERFACE_XML = `<node><interface name="${INTERFACE}">
  <method name="Show"/><method name="Lock"/><method name="Quit"/>
  <property name="Locked" type="b" access="read"/>
  <property name="Busy" type="b" access="read"/>
  <property name="Background" type="b" access="read"/>
</interface></node>`;
const VaultProxy = Gio.DBusProxy.makeProxyWrapper(INTERFACE_XML);

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
        this._indicator = new VaultIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
