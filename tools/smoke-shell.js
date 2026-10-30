// Run only in a disposable GNOME Shell with --automation-script.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sleep} from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};
function check(value, message) {
    if (!value)
        throw new Error(message);
}
async function until(predicate, message) {
    for (let i = 0; i < 200; i++) {
        if (predicate())
            return;
        await sleep(50);
    }
    throw new Error(message);
}
export async function run() {
    const uuid = 'keyslot@neg-zero';
    const background = Main.panel.statusArea.quickSettings._backgroundApps.quickSettingsItems[0];
    const originalSync = Object.getPrototypeOf(background)._sync;
    await Main.extensionManager.enableExtension(uuid);
    await until(() => Main.extensionManager.lookup(uuid)?.state === 1, 'Extension did not become active');
    const extension = Main.extensionManager.lookup(uuid).stateObj;
    const tile = extension._indicator.quickSettingsItems[0];
    const executable = GLib.getenv('KEYSLOT_TEST_EXECUTABLE');
    check(executable, 'Set KEYSLOT_TEST_EXECUTABLE to the built app');
    GLib.setenv('WAYLAND_DISPLAY', 'wayland-0', true);
    const [, pid] = GLib.spawn_async(null, [executable, '--background'], null,
        GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD, null);
    GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, () => GLib.spawn_close_pid(pid));
    const rows = () => background._appsSection._getMenuItems().filter(item => item.label?.text === 'Keyslot');
    await until(() => tile._proxy?.Background && rows().length === 1, 'Native background row missing or duplicated');
    check(background.visible, 'Background Apps control stayed hidden');
    tile._sync();
    tile._sync();
    check(rows().length === 1, 'Status refresh duplicated the native row');
    rows()[0].activate(null);
    await until(() => tile._proxy.Background === false && rows().length === 0, 'Opening Keyslot did not remove background row');
    await until(() => global.get_window_actors().some(actor => actor.meta_window.get_gtk_application_id() === 'com.neg-zero.keyslot'), 'Keyslot window did not appear');
    global.get_window_actors().find(actor => actor.meta_window.get_gtk_application_id() === 'com.neg-zero.keyslot')
        .meta_window.delete(global.get_current_time());
    await until(() => tile._proxy.Background && rows().length === 1, 'Closing window did not return to background');
    const row = rows()[0];
    row.get_last_child().emit('clicked', 1);
    await until(() => !tile._proxy.g_name_owner && rows().length === 0, 'Background Quit did not stop Keyslot');
    await Main.extensionManager.disableExtension(uuid);
    await until(() => Object.getPrototypeOf(background)._sync === originalSync, 'Disable did not restore GNOME methods');
    check(rows().length === 0, 'Disable left a background row behind');
    print('GNOME 50 native Background Apps: enable, status, deduplication, Open, hide, Quit and disable cleanup: PASS');
}
