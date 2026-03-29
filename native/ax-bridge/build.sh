#!/bin/bash
# Build the ax-bridge Swift CLI binary
# Usage: ./build.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building ax-bridge..."

swiftc \
    -O \
    -o ax-bridge \
    -framework Cocoa \
    -framework ApplicationServices \
    main.swift

echo "Built: $SCRIPT_DIR/ax-bridge"

# Verify it runs
if ./ax-bridge check-permission 2>/dev/null; then
    echo "Binary verified OK"
else
    echo "Warning: Binary built but check-permission returned non-zero (permissions may be needed)"
fi
