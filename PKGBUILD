# Maintainer: bluewizardz <your@email.com>
pkgname=clockly
pkgver=1.0.0
pkgrel=1
pkgdesc="A lightweight time management suite featuring Clock, Alarm, Timer, and Stopwatch"
arch=('x86_64')
url="https://github.com/bluewizardz/clockly"
license=('MIT')
depends=(
    'webkit2gtk-4.1'
    'gtk3'
    'libayatana-appindicator'
)
makedepends=(
    'rust'
    'cargo'
    'npm'
    'git'
)
options=('!lto')  # Tauri manages LTO itself via Cargo profile
source=("$pkgname::git+$url.git#tag=v$pkgver")
sha256sums=('SKIP')

prepare() {
    cd "$pkgname"
    # Install Node.js dependencies (needed for Tauri CLI)
    npm ci --ignore-scripts
    # Fetch Rust/Cargo dependencies offline-friendly
    cargo fetch --manifest-path src-tauri/Cargo.toml --locked
}

build() {
    cd "$pkgname"
    # CARGO_HOME is set so fetched deps are reused
    export RUSTUP_TOOLCHAIN=stable
    export CARGO_TARGET_DIR="$srcdir/target"

    npm run build -- --no-bundle  2>/dev/null || \
    npx tauri build --bundles none
}

package() {
    cd "$pkgname"

    local _binary="src-tauri/target/release/clockly"
    local _tauri_dir="src-tauri/target/release/bundle"

    # Install main binary
    install -Dm755 "$_binary" "$pkgdir/usr/bin/$pkgname"

    # Install desktop entry
    install -Dm644 "src-tauri/gen/linux/$pkgname.desktop" \
        "$pkgdir/usr/share/applications/$pkgname.desktop" 2>/dev/null || \
    cat > "$pkgdir/usr/share/applications/$pkgname.desktop" <<EOF
[Desktop Entry]
Name=Clockly
Comment=A lightweight time management suite
Exec=clockly
Icon=clockly
Type=Application
Categories=Utility;Clock;
Keywords=clock;timer;stopwatch;alarm;time;
StartupWMClass=clockly
EOF

    # Install icons (multiple sizes if available)
    for _size in 32 128 256; do
        local _icon="src-tauri/icons/${_size}x${_size}.png"
        if [[ -f "$_icon" ]]; then
            install -Dm644 "$_icon" \
                "$pkgdir/usr/share/icons/hicolor/${_size}x${_size}/apps/$pkgname.png"
        fi
    done

    # Fallback: install the largest available icon
    if [[ -f "src-tauri/icons/128x128@2x.png" ]]; then
        install -Dm644 "src-tauri/icons/128x128@2x.png" \
            "$pkgdir/usr/share/icons/hicolor/256x256/apps/$pkgname.png"
    fi

    # Install license if present
    if [[ -f "LICENSE" ]]; then
        install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
    fi
}
