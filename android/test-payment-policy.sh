#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
classes="$(mktemp -d)"
trap 'rm -rf "$classes"' EXIT HUP INT TERM
# Calling the compiler module also works when the JDK's javac launcher is absent.
java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -d "$classes" \
  app/src/main/java/com/raisethebar/game/PaymentNavigationPolicy.java \
  tests/PaymentNavigationPolicyCheck.java
java -cp "$classes" com.raisethebar.game.PaymentNavigationPolicyCheck
