#!/usr/bin/env bash
set -euo pipefail

# Install Clojure CLI tools (requires Java 11+)
# https://clojure.org/guides/install_clojure

CLOJURE_VERSION="1.12.0.1530"

if command -v clojure &>/dev/null; then
  echo "Clojure is already installed: $(clojure --version)"
  exit 0
fi

if ! command -v java &>/dev/null; then
  echo "Error: Java is required but not installed." >&2
  exit 1
fi

echo "Installing Clojure CLI ${CLOJURE_VERSION}..."
curl -fsSL "https://download.clojure.org/install/linux-install-${CLOJURE_VERSION}.sh" -o /tmp/clojure-install.sh
chmod +x /tmp/clojure-install.sh
/tmp/clojure-install.sh
rm -f /tmp/clojure-install.sh

echo "Clojure installed: $(clojure --version)"
