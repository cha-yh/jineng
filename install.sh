#!/usr/bin/env bash
set -euo pipefail

REPO="${JINENG_REPO:-cha-yh/jineng}"
INSTALL_DIR="${JINENG_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${1:-latest}"

err() {
  echo "jineng install: $*" >&2
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "$1 is required"
    exit 1
  fi
}

need curl

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

case "$os" in
  darwin) platform="darwin" ;;
  linux) platform="linux" ;;
  *)
    err "unsupported OS: $os"
    exit 1
    ;;
esac

case "$arch" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *)
    err "unsupported architecture: $arch"
    exit 1
    ;;
esac

if [ "$VERSION" = "latest" ]; then
  tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  if [ -z "$tag" ]; then
    err "failed to resolve latest release"
    exit 1
  fi
else
  tag="$VERSION"
  case "$tag" in
    v*) ;;
    *) tag="v$tag" ;;
  esac
fi

asset="jineng-${platform}-${arch}"
base_url="https://github.com/$REPO/releases/download/$tag"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Installing Jineng $tag for ${platform}-${arch}"
curl -fsSL "$base_url/$asset" -o "$tmp_dir/jineng"

if curl -fsSL "$base_url/$asset.sha256" -o "$tmp_dir/jineng.sha256"; then
  expected="$(awk '{print $1}' "$tmp_dir/jineng.sha256")"
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$tmp_dir/jineng" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp_dir/jineng" | awk '{print $1}')"
  else
    err "shasum or sha256sum is required to verify checksum"
    exit 1
  fi
  if [ "$expected" != "$actual" ]; then
    err "checksum verification failed"
    exit 1
  fi
else
  err "checksum file not found; refusing to install"
  exit 1
fi

mkdir -p "$INSTALL_DIR"
chmod +x "$tmp_dir/jineng"
mv "$tmp_dir/jineng" "$INSTALL_DIR/jineng"

echo "Installed $INSTALL_DIR/jineng"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo
    echo "Add this to your shell profile if jineng is not found:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
