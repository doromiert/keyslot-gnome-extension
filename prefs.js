// SPDX-License-Identifier: GPL-3.0-only
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const KEY = 'auto-type';
const MODIFIERS = Gdk.ModifierType.SHIFT_MASK | Gdk.ModifierType.CONTROL_MASK |
    Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK |
    Gdk.ModifierType.META_MASK | Gdk.ModifierType.HYPER_MASK;
const same = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
const canonical = value => {
    const [valid, key, modifiers] = Gtk.accelerator_parse(value);
    return valid && key ? Gtk.accelerator_name(Gdk.keyval_to_lower(key), modifiers & MODIFIERS) : value;
};

export default class KeyslotPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const _ = this.gettext.bind(this);
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: _('Keyboard Shortcuts'), icon_name: 'input-keyboard-symbolic'});
        const group = new Adw.PreferencesGroup({title: _('Desktop Auto-Type'),
            description: _('Open Keyslot from another application. Default: Ctrl+Alt+K. ') +
                _('If another desktop action uses your combination, choose a different one.')});
        const status = new Gtk.Label({wrap: true, xalign: 0, css_classes: ['error'], visible: false});
        const notices = new Adw.PreferencesGroup();
        notices.add(status);
        page.add(group);
        page.add(notices);
        window.add(page);
        window.search_enabled = false;
        window.set_default_size(640, 480);
        let rows = [];
        let closed = false;
        let recording = null;
        const error = message => {
            status.set_label(message);
            status.set_visible(Boolean(message));
        };
        const writable = () => {
            if (closed)
                return false;
            if (!settings.is_writable(KEY)) {
                error(_('Desktop policy prevents changing these shortcuts.'));
                return false;
            }
            return true;
        };
        const write = (values, expected) => {
            if (!writable())
                return false;
            if (!same(settings.get_strv(KEY), expected)) {
                error(_('Shortcuts changed elsewhere. Try again.'));
                return false;
            }
            try {
                if (!settings.set_strv(KEY, values))
                    throw new Error('write failed');
                error('');
                return true;
            } catch {
                error(_('The shortcut could not be saved.'));
                return false;
            }
        };
        const record = (expected, index = null) => {
            if (recording || !writable())
                return;
            const surface = window.get_surface();
            if (!surface || typeof surface.inhibit_system_shortcuts !== 'function') {
                error(_('The desktop cannot capture shortcuts in this window.'));
                return;
            }
            const dialog = new Adw.Dialog({title: _('Set Auto-Type Shortcut'), content_width: 420,
                content_height: 280, can_close: false});
            const toolbar = new Adw.ToolbarView();
            const header = new Adw.HeaderBar();
            toolbar.add_top_bar(header);
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 16,
                margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24});
            box.append(new Gtk.Image({icon_name: 'input-keyboard-symbolic', pixel_size: 48}));
            box.append(new Gtk.Label({label: _('Press a key combination'), wrap: true, css_classes: ['title-3']}));
            box.append(new Gtk.Label({label: _('Use Escape to cancel.'), wrap: true}));
            const message = new Gtk.Label({wrap: true});
            box.append(message);
            toolbar.set_content(box);
            dialog.set_child(toolbar);
            let released = false;
            let signal = 0;
            const cleanup = () => {
                if (released)
                    return;
                released = true;
                if (signal)
                    surface.disconnect(signal);
                try {
                    surface.restore_system_shortcuts();
                } catch {
                    // An unrealized surface has already lost the inhibition.
                }
                recording = null;
            };
            const finish = () => {
                cleanup();
                dialog.force_close();
            };
            const cancel = new Gtk.Button({label: _('Cancel'), valign: Gtk.Align.CENTER});
            cancel.connect('clicked', finish);
            header.pack_start(cancel);
            recording = {finish};
            const ready = () => {
                message.set_label(surface.shortcuts_inhibited
                    ? _('Use a function key or a combination with Ctrl, Alt, Super, Meta or Hyper.')
                    : _('Waiting for desktop shortcut capture. Allow it if the desktop asks.'));
            };
            signal = surface.connect('notify::shortcuts-inhibited', ready);
            dialog.connect('closed', cleanup);
            dialog.connect('close-attempt', finish);
            const controller = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
            controller.connect('key-pressed', (_controller, key, _code, state) => {
                if (key === Gdk.KEY_Escape) {
                    finish();
                    return true;
                }
                if (closed || released || !surface.shortcuts_inhibited)
                    return true;
                let modifiers = state & MODIFIERS;
                if (key === Gdk.KEY_ISO_Left_Tab) {
                    key = Gdk.KEY_Tab;
                    modifiers |= Gdk.ModifierType.SHIFT_MASK;
                } else {
                    const event = controller.get_current_event();
                    if (event && Gdk.keyval_to_lower(key) === key)
                        modifiers &= ~event.get_consumed_modifiers();
                }
                key = Gdk.keyval_to_lower(key);
                if (!Gtk.accelerator_valid(key, modifiers))
                    return true;
                if (!(modifiers & ~Gdk.ModifierType.SHIFT_MASK) && !(key >= Gdk.KEY_F1 && key <= Gdk.KEY_F35)) {
                    message.set_label(_('Use a function key or add Ctrl, Alt, Super, Meta or Hyper.'));
                    return true;
                }
                const value = Gtk.accelerator_name(key, modifiers);
                if (expected.some((old, position) => position !== index && canonical(old) === canonical(value))) {
                    message.set_label(_('This shortcut is already in the list.'));
                    return true;
                }
                const next = [...expected];
                if (index === null)
                    next.push(value);
                else
                    next[index] = value;
                if (write(next, expected))
                    finish();
                else
                    message.set_label(_('The shortcut was not saved. Close this recorder and try again.'));
                return true;
            });
            dialog.add_controller(controller);
            dialog.present(window);
            try {
                surface.inhibit_system_shortcuts(null);
                ready();
            } catch {
                message.set_label(_('The desktop could not start shortcut recording. Use Escape to cancel.'));
            }
        };
        const controls = new Gtk.Box({spacing: 6});
        const add = new Gtk.Button({icon_name: 'list-add-symbolic', tooltip_text: _('Add Shortcut'),
            valign: Gtk.Align.CENTER, css_classes: ['flat']});
        const reset = new Gtk.Button({icon_name: 'edit-undo-symbolic', tooltip_text: _('Reset Auto-Type Shortcuts'),
            valign: Gtk.Align.CENTER, css_classes: ['flat']});
        controls.append(add);
        controls.append(reset);
        group.set_header_suffix(controls);
        add.connect('clicked', () => record(settings.get_strv(KEY)));
        reset.connect('clicked', () => {
            if (!writable())
                return;
            try {
                settings.reset(KEY);
                error('');
            } catch {
                error(_('The shortcuts could not be reset.'));
            }
        });
        const refresh = () => {
            if (closed)
                return;
            rows.forEach(row => group.remove(row));
            rows = [];
            const values = settings.get_strv(KEY);
            values.forEach((value, index) => {
                const [valid, key, modifiers] = Gtk.accelerator_parse(value);
                const supported = valid && key && Gtk.accelerator_valid(key, modifiers);
                const row = new Adw.ActionRow({title: supported ? Gtk.accelerator_get_label(key, modifiers) : (value || _('Empty binding')),
                    subtitle: supported ? '' : _('Unsupported binding. Change or remove it.'), use_markup: false});
                const change = new Gtk.Button({icon_name: 'document-edit-symbolic', tooltip_text: _('Change Shortcut'),
                    valign: Gtk.Align.CENTER, css_classes: ['flat']});
                const remove = new Gtk.Button({icon_name: 'edit-delete-symbolic', tooltip_text: _('Remove Shortcut'),
                    valign: Gtk.Align.CENTER, css_classes: ['flat']});
                change.connect('clicked', () => record(values, index));
                remove.connect('clicked', () => write(values.filter((_value, position) => position !== index), values));
                row.add_suffix(change);
                row.add_suffix(remove);
                row.set_activatable_widget(change);
                group.add(row);
                rows.push(row);
            });
            if (!values.length) {
                const row = new Adw.ActionRow({title: _('Desktop Auto-Type Disabled'),
                    subtitle: _('Add a shortcut to enable it.')});
                group.add(row);
                rows.push(row);
            }
            group.set_sensitive(settings.is_writable(KEY));
            if (!settings.is_writable(KEY))
                error(_('Desktop policy prevents changing these shortcuts.'));
        };
        const signals = [settings.connect(`changed::${KEY}`, refresh),
            settings.connect(`writable-changed::${KEY}`, refresh)];
        window.connect('close-request', () => {
            if (closed)
                return false;
            closed = true;
            recording?.finish();
            signals.forEach(signal => settings.disconnect(signal));
            return false;
        });
        refresh();
    }
}
