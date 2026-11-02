// SPDX-License-Identifier: GPL-3.0-only
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as CheckBox from 'resource:///org/gnome/shell/ui/checkBox.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const BUS_NAME = 'com.neg-zero.keyslot';
const XML = `<node><interface name="com.neg_zero.keyslot.Browser1">
  <method name="Approve"><arg type="s" direction="in"/><arg type="s" direction="in"/>
    <arg type="s" direction="out"/></method>
  <method name="Cancel"><arg type="s" direction="in"/></method>
</interface></node>`;

function text(value) {
    return value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 1024);
}

// Only the current application's bus owner can request a dialog. No password crosses this interface.
export class BrowserApprovals {
    constructor(owner) {
        this._owner = owner;
        this._pending = null;
        this._sessionId = Main.sessionMode.connect('updated', () => {
            if (Main.sessionMode.isLocked)
                this._finish(null);
        });
        this._ownerId = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', BUS_NAME, Gio.DBusSignalFlags.NONE,
            (_bus, _sender, _path, _iface, _name, args) => {
                if (this._pending && args.deep_unpack()[2] !== this._pending.owner)
                    this._finish(null);
            });
        this._object = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this._object.export(Gio.DBus.session, '/com/neg_zero/keyslot/Browser1');
    }

    _authorized(invocation) {
        if (this._owner() && invocation.get_sender() === this._owner())
            return true;
        invocation.return_dbus_error('org.freedesktop.DBus.Error.AccessDenied', 'Only Keyslot may request approval');
        return false;
    }

    ApproveAsync([token, payload], invocation) {
        if (!this._authorized(invocation))
            return;
        let data;
        try {
            if (payload.length > 262144)
                throw new Error('Approval metadata too large');
            data = JSON.parse(payload);
            const string = value => typeof value === 'string' && value.length <= 16384;
            if (!/^[0-9a-f]{32}$/.test(token) || payload.length > 262144 || !data ||
                !string(data.connection) || !string(data.database) || !string(data.origin) || !string(data.destination) ||
                typeof data.http_auth !== 'boolean' || !Array.isArray(data.entries) ||
                !data.entries.length || data.entries.length > 1000 || data.entries.some(entry =>
                    !entry || !string(entry.uuid) || !entry.uuid || !string(entry.title) ||
                    !string(entry.username) || !string(entry.group) || typeof entry.allowed !== 'boolean') ||
                new Set(data.entries.map(entry => entry.uuid)).size !== data.entries.length)
                throw new Error('Invalid approval metadata');
        } catch {
            invocation.return_dbus_error('org.freedesktop.DBus.Error.InvalidArgs', 'Invalid approval metadata');
            return;
        }
        if (this._pending || Main.sessionMode.isLocked || Main.modalCount > 0) {
            invocation.return_value(new GLib.Variant('(s)', ['null']));
            return;
        }
        const dialog = new ModalDialog.ModalDialog({styleClass: 'keyslot-browser-approval',
            shouldFadeOut: false, destroyOnClose: false});
        this._pending = {token, invocation, dialog, owner: invocation.get_sender(), source: 0};
        dialog.connect('closed', () => this._finish(null));
        try {
            this._build(dialog, data);
            if (!dialog.open()) {
                this._finish(null);
                return;
            }
            this._pending.source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 25, () => {
                if (this._pending)
                    this._pending.source = 0;
                this._finish(null);
                return GLib.SOURCE_REMOVE;
            });
        } catch {
            this._finish(null);
        }
    }

    _build(dialog, data) {
        dialog.contentLayout.add_child(new Dialog.MessageDialogContent({title: _('Browser Access'),
            description: text(data.connection) + '\n' + (text(data.database) || _('Password Database'))}));
        const origin = new St.Label({text: text(data.origin), style_class: 'keyslot-browser-origin'});
        origin.clutter_text.set_line_wrap(true);
        dialog.contentLayout.add_child(origin);
        if (data.destination && data.destination !== data.origin) {
            const destination = new St.Label({text: _('Sign-in form destination:') + '\n' + text(data.destination)});
            destination.clutter_text.set_line_wrap(true);
            dialog.contentLayout.add_child(destination);
        }
        const scroll = new St.ScrollView({style_class: 'keyslot-browser-entries',
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true});
        const list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        scroll.set_child(list);
        dialog.contentLayout.add_child(scroll);
        const choices = new Map();
        for (const entry of data.entries) {
            const name = text(entry.title) || _('Untitled Entry');
            const detail = text(entry.username || entry.group);
            const check = new CheckBox.CheckBox(detail ? `${name}\n${detail}` : name);
            check.checked = entry.allowed || data.entries.length === 1;
            check.getLabelActor().clutter_text.set_line_wrap(false);
            check.getLabelActor().clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            list.add_child(check);
            choices.set(entry.uuid, check);
        }
        const remember = new CheckBox.CheckBox(_('Remember This Decision'));
        dialog.contentLayout.add_child(remember);
        const explanation = new St.Label({text: _('Full trust shares matching logins automatically in this database. Hidden entries and denied websites stay blocked. Revoke trust in Browser Connections.'),
            style_class: 'keyslot-browser-explanation'});
        explanation.clutter_text.set_line_wrap(true);
        dialog.contentLayout.add_child(explanation);
        const trust = new St.Button({label: _('Fully Trust This Browser'), style_class: 'button',
            reactive: true, can_focus: true, x_expand: true});
        dialog.contentLayout.add_child(trust);
        const selected = () => [...choices].filter(([_id, check]) => check.checked).map(([id]) => id);
        const submit = (allow, fullTrust = false) => {
            if (Main.sessionMode.isLocked || !this._pending || this._pending.owner !== this._owner()) {
                this._finish(null);
                return;
            }
            const entries = selected();
            if (allow && !entries.length)
                return;
            this._finish({allow, selected: entries, remember: remember.checked, trust: fullTrust});
        };
        trust.connect('clicked', () => submit(true, true));
        dialog.addButton({label: _('Deny'), key: Clutter.KEY_Escape, default: true,
            action: () => submit(false)});
        const allow = dialog.addButton({label: _('Allow Selected'), action: () => submit(true)});
        const update = () => {
            const enabled = selected().length > 0;
            for (const button of [allow, trust]) {
                button.reactive = enabled;
                button.can_focus = enabled;
            }
        };
        for (const check of choices.values())
            check.connect('notify::checked', update);
        update();
    }

    CancelAsync([token], invocation) {
        if (!this._authorized(invocation))
            return;
        if (this._pending?.token === token && this._pending.owner === invocation.get_sender())
            this._finish(null);
        invocation.return_value(null);
    }

    _finish(choice) {
        const pending = this._pending;
        this._pending = null;
        if (!pending)
            return;
        if (pending.source)
            GLib.source_remove(pending.source);
        // Closing without animation removes entry metadata immediately on lock or cancellation.
        pending.dialog.close();
        pending.dialog.destroy();
        pending.invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(choice)]));
    }

    destroy() {
        this._finish(null);
        Main.sessionMode.disconnect(this._sessionId);
        Gio.DBus.session.signal_unsubscribe(this._ownerId);
        this._object.unexport();
    }
}
