#!/bin/bash
# Generate mahjong-scoreboard release keystore.
# Passwords live in macOS Keychain under mahjong-scoreboard.STORE_PW / KEY_PW.
set -e
KEYSTORE_PATH="$HOME/mahjong-scoreboard/mahjong-release.jks"
ALIAS="mahjong"
DNAME="CN=Mahjong Scoreboard, OU=Mobile, O=Comparetiger, L=HK, S=HK, C=HK"

if [ -f "$KEYSTORE_PATH" ]; then
    echo "Keystore already exists at $KEYSTORE_PATH — skipping generation"
    exit 0
fi

STORE_PW=$(security find-generic-password -a extraier -s mahjong-scoreboard.STORE_PW -w)
KEY_PW=$(security find-generic-password -a extraier -s mahjong-scoreboard.KEY_PW -w)

keytool -genkey -v -noprompt \
    -keystore "$KEYSTORE_PATH" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$STORE_PW" -keypass "$KEY_PW" \
    -dname "$DNAME"

echo "Generated: $KEYSTORE_PATH"
ls -la "$KEYSTORE_PATH"
