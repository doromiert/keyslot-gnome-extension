{ pkgs ? import <nixpkgs> {} }:
pkgs.stdenvNoCC.mkDerivation {
  pname = "gnome-shell-extension-keyslot";
  version = "0.2.0";
  src = pkgs.lib.cleanSource ./.;
  dontBuild = true;
  nativeBuildInputs = [ pkgs.glib ];
  installPhase = ''
    runHook preInstall
    destination="$out/share/gnome-shell/extensions/keyslot@neg-zero"
    install -Dm644 metadata.json "$destination/metadata.json"
    install -Dm644 extension.js "$destination/extension.js"
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
