#!/bin/zsh
# Creates "Cadence Local Signing", a private self-signed code-signing certificate in your login
# keychain, used by build.sh so every build of Cadence keeps the same identity. Nothing is sent
# anywhere and no Apple account is needed. Remove it any time in Keychain Access.
set -eu
NAME="Cadence Local Signing"
if security find-identity -p codesigning 2>/dev/null | grep -qF "\"$NAME\""; then echo "\"$NAME\" already exists."; exit 0; fi
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT; umask 077
cat > "$WORK/cert.cnf" <<CNF
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=$NAME
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
CNF
# macOS's own LibreSSL writes a PKCS#12 file that the security tool can import.
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -config "$WORK/cert.cnf" 2>/dev/null
PASS=$(/usr/bin/openssl rand -hex 16)
/usr/bin/openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" -name "$NAME" -out "$WORK/id.p12" -passout "pass:$PASS"
security import "$WORK/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$PASS" -T /usr/bin/codesign
echo "Created \"$NAME\". Rebuild with ./build.sh; the next launch asks for Keychain access once — choose Always Allow."
