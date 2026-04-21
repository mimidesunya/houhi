#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

WSL_NODE_VERSION=${HOUHI_WSL_NODE_VERSION:-20.12.1}

run_default_steps() {
    echo "[1/3] setup.ts を実行します..."
    npm run setup

    echo "[2/3] ツールドキュメントを再生成します..."
    npm run docs:tools

    echo "[3/3] テストを実行します..."
    npm test

    echo "完了しました。"
}

is_wsl() {
    if [ -n "${WSL_DISTRO_NAME:-}" ] || [ -n "${WSL_INTEROP:-}" ]; then
        return 0
    fi

    if [ -r /proc/version ] && grep -qi microsoft /proc/version 2>/dev/null; then
        return 0
    fi

    return 1
}

can_run_node_here() {
    if ! command -v node >/dev/null 2>&1; then
        return 1
    fi

    node -e "process.exit(0)" >/dev/null 2>&1
}

get_wsl_node_arch() {
    MACHINE=$(uname -m 2>/dev/null || printf '')

    case "$MACHINE" in
        x86_64|amd64)
            printf 'x64'
            ;;
        aarch64|arm64)
            printf 'arm64'
            ;;
        *)
            echo "未対応の WSL CPU アーキテクチャです: $MACHINE" >&2
            return 1
            ;;
    esac
}

ensure_local_wsl_node() {
    if ! is_wsl; then
        return 1
    fi

    if can_run_node_here; then
        return 0
    fi

    if ! command -v curl >/dev/null 2>&1; then
        echo "WSL に curl が見つからないため、ローカル Node.js を取得できません。" >&2
        return 1
    fi

    if ! command -v tar >/dev/null 2>&1; then
        echo "WSL に tar が見つからないため、ローカル Node.js を展開できません。" >&2
        return 1
    fi

    NODE_ARCH=$(get_wsl_node_arch) || return 1
    CACHE_DIR="$SCRIPT_DIR/.cache/tools"
    NODE_BASENAME="node-v$WSL_NODE_VERSION-linux-$NODE_ARCH"
    NODE_DIR="$CACHE_DIR/$NODE_BASENAME"
    NODE_BIN_DIR="$NODE_DIR/bin"
    ARCHIVE_PATH="$CACHE_DIR/$NODE_BASENAME.tar.xz"
    TMP_DIR="$CACHE_DIR/.tmp-$NODE_BASENAME"
    DOWNLOAD_URL="https://nodejs.org/dist/v$WSL_NODE_VERSION/$NODE_BASENAME.tar.xz"

    if [ ! -x "$NODE_BIN_DIR/node" ]; then
        mkdir -p "$CACHE_DIR"
        echo "WSL で使う Linux 版 Node.js v$WSL_NODE_VERSION を準備します..."

        if [ ! -f "$ARCHIVE_PATH" ]; then
            curl -fsSL "$DOWNLOAD_URL" -o "$ARCHIVE_PATH.tmp"
            mv "$ARCHIVE_PATH.tmp" "$ARCHIVE_PATH"
        fi

        rm -rf "$TMP_DIR"
        mkdir -p "$TMP_DIR"
        tar -xJf "$ARCHIVE_PATH" -C "$TMP_DIR"
        rm -rf "$NODE_DIR"
        mv "$TMP_DIR/$NODE_BASENAME" "$NODE_DIR"
        rm -rf "$TMP_DIR"
    fi

    PATH="$NODE_BIN_DIR:$PATH"
    export PATH

    if can_run_node_here; then
        echo "WSL でローカル Node.js を使用します: $NODE_BIN_DIR/node"
        return 0
    fi

    echo "ローカル Node.js を準備しましたが、まだ実行できません。" >&2
    return 1
}

should_run_via_windows() {
    if [ "${HOUHI_FORCE_WINDOWS_NPM:-0}" = "1" ]; then
        return 0
    fi

    if ! is_wsl; then
        return 1
    fi

    if can_run_node_here; then
        return 1
    fi

    if ensure_local_wsl_node; then
        return 1
    fi

    return 0
}

can_run_windows_interop() {
    if ! command -v cmd.exe >/dev/null 2>&1; then
        return 1
    fi

    cmd.exe /d /c exit 0 >/dev/null 2>&1
}

run_windows_steps_via_interop() {
    if ! command -v wslpath >/dev/null 2>&1; then
        echo "WSL で Node.js を直接実行できず、Windows フォールバックも使えません。PowerShell で 'npm run setup' を実行してください。" >&2
        exit 1
    fi

    if ! can_run_windows_interop; then
        echo "WSL で Node.js を直接実行できず、Windows コマンド起動も使えませんでした。" >&2
        echo "PowerShell で '.\\setup.cmd' または 'npm run setup' を実行してください。" >&2
        exit 1
    fi

    WINDOWS_DIR=$(wslpath -w "$SCRIPT_DIR")
    echo "WSL で Node.js を直接実行できないため、Node.js 系コマンドは Windows 側で実行します..."

    HOUHI_SETUP_DIR="$WINDOWS_DIR" cmd.exe /d /c "cd /d %HOUHI_SETUP_DIR% && setup.cmd"
}

if should_run_via_windows; then
    run_windows_steps_via_interop
else
    run_default_steps
fi
