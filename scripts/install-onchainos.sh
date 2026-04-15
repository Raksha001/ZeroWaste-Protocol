#!/bin/bash

# Define installation directory relative to project root
INSTALL_DIR="./.local/bin"
BINARY_NAME="onchainos"
TARGET_PATH="$INSTALL_DIR/$BINARY_NAME"

# Check if already installed
if [ -f "$TARGET_PATH" ]; then
    echo "✅ Onchain OS binary already exists at $TARGET_PATH"
    exit 0
fi

echo "⏳ Installing Onchain OS binary to $INSTALL_DIR..."

# Create directory
mkdir -p "$INSTALL_DIR"

# Detect OS and Arch (Simplified for Render/Linux)
# Render uses Ubuntu/Linux
OS="linux"
ARCH="amd64"

# If we are on Mac (local dev)
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="darwin"
    if [[ $(uname -m) == "arm64" ]]; then
        ARCH="arm64"
    fi
fi

# Construct download URL (assuming standard versioning or latest)
# We use the official install script's logic but pipe it to a specific dir if possible, 
# or just download the binary directly if we know the location.
# However, the official script is safer. We'll set HOME temp to redirect it.

HOME_ORIG=$HOME
export HOME=$(pwd) # Temporarily set HOME to current dir so script installs to ./.local/bin

curl -sSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh

export HOME=$HOME_ORIG

if [ -f "./.local/bin/onchainos" ]; then
    echo "✅ Onchain OS binary installed successfully!"
else
    echo "❌ Installation failed."
    exit 1
fi
