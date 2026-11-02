{ pkgs ? import <nixpkgs> {} }:
pkgs.stdenvNoCC.mkDerivation {
  pname = "gnome-shell-extension-keyslot";
  version = "0.4.0";
  src = pkgs.lib.cleanSource ./.;
  dontBuild = true;
  nativeBuildInputs = [ pkgs.glib pkgs.gettext ];
  installPhase = ''
    runHook preInstall
    destination="$out/share/gnome-shell/extensions/keyslot@neg-zero"
    install -Dm644 metadata.json "$destination/metadata.json"
    install -Dm644 extension.js "$destination/extension.js"
    install -Dm644 browserApproval.js "$destination/browserApproval.js"
    install -Dm644 stylesheet.css "$destination/stylesheet.css"
    install -Dm644 prefs.js "$destination/prefs.js"
    for language in pl ro; do
      install -d "$destination/locale/$language/LC_MESSAGES"
      msgfmt -o "$destination/locale/$language/LC_MESSAGES/keyslot@neg-zero.mo" "po/$language.po"
    done
    install -Dm644 schemas/org.gnome.shell.extensions.keyslot.gschema.xml "$destination/schemas/org.gnome.shell.extensions.keyslot.gschema.xml"
    glib-compile-schemas "$destination/schemas"
    install -Dm644 LICENSE "$out/share/licenses/keyslot-extension/LICENSE"
    runHook postInstall
  '';
  passthru.extensionUuid = "keyslot@neg-zero";
  meta = {
    description = "Keyslot lock controls in GNOME 50 Quick Settings";
    license = pkgs.lib.licenses.gpl3Only;
    platforms = pkgs.lib.platforms.linux;
  };
}
