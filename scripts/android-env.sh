#!/bin/bash
# Android + Java env for Capacitor builds
# Source this before any cap or gradle command: `source ~/mahjong-scoreboard/scripts/android-env.sh`
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# Capacitor uses compileSdkVersion from android/variables.gradle — keep here for reference
echo "JAVA_HOME=$JAVA_HOME"
echo "ANDROID_HOME=$ANDROID_HOME"
java -version 2>&1 | head -1
