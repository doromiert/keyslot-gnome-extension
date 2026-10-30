"""Run the real GNOME Shell integration test without touching the user's session."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--app', type=Path, required=True, help='Built Keyslot executable')
args = parser.parse_args()
source = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='keyslot-shell-') as directory:
    root = Path(directory)
    env = os.environ.copy()
    for name, leaf in [('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'),
                       ('XDG_CACHE_HOME', 'cache'), ('XDG_RUNTIME_DIR', 'runtime')]:
        path = root / leaf
        path.mkdir(mode=0o700)
        env[name] = str(path)
    env.update(GSETTINGS_BACKEND='memory', GTK_A11Y='none', GNOME_SHELL_SESSION_MODE='user',
               KEYSLOT_TEST_EXECUTABLE=str(args.app.resolve()))
    extension = root / 'data/gnome-shell/extensions/keyslot@neg-zero'
    extension.mkdir(parents=True)
    for name in ['metadata.json', 'extension.js', 'LICENSE']:
        shutil.copyfile(source / name, extension / name)
    config = root / 'session.conf'
    config.write_text('<busconfig><type>session</type><listen>unix:tmpdir=/tmp</listen>'
        '<policy context="default"><allow own="*"/><allow send_destination="*"/>'
        '<allow receive_sender="*"/></policy></busconfig>')
    result = subprocess.run(['dbus-run-session', '--config-file=' + str(config), '--',
        'gnome-shell', '--headless', '--wayland', '--no-x11', '--virtual-monitor=1280x800',
        '--automation-script=' + str(source / 'tools/smoke-shell.js')],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=45)
    marker = 'GNOME 50 native Background Apps: enable, status, deduplication, Open, hide, Quit and disable cleanup: PASS'
    if result.returncode or marker not in result.stdout:
        print(result.stdout)
        raise SystemExit(result.returncode or 1)
    print(marker)
