# Changelog

All notable changes to NetIdent are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-26

### Added

- Dashboard popup with a connection header: link type, device name, link speed and an online badge.
- Live traffic card with download and upload rates, a 60 second graph and session totals.
- Internet latency, jitter and packet loss from a ping probe, plus gateway latency. The probe host is configurable.
- Local IP of the active interface, with the interface and connection name. Click to copy.
- Speed test button. Uses the Ookla speedtest CLI, speedtest-cli or a built-in test against Cloudflare with curl.
- Tailscale on/off toggle in the popup.
- Tailscale DNS name in the Tailscale details.
- Live download and upload rates in the top bar, with a setting to hide them.
- Light stylesheet. GNOME Shell 50 and later switch between the dark and light variants with the system color scheme.
- Support for GNOME Shell 51.
- `build.sh` to bump the major, minor or patch version and build the zip into `dist/`.

### Changed

- The top bar shows the Tailscale icon when Tailscale is connected and a VPN icon when a VPN is active, instead of a lock icon.
- The country flag replaces the online dot in the top bar.
- The public IP shows the ISP and the full country name. Click to copy.
- VPN, routing, DNS, proxy and connection details moved into three expandable rows: Internet route, Tailscale and Connection details.
- The popup updates in place on refresh instead of rebuilding the whole menu.
- Colors come from the GNOME Shell theme instead of fixed values.
- The external IP in the top bar is off by default. Enable it in the preferences.
- The extension sources moved to `src/`. The Makefile lives at the repository root.

### Removed

- The `make release` target. Use `./build.sh major`, `minor` or `patch` instead.

## [1.0.0] - 2026-04-16

### Added

- Initial release.
- Top bar indicator with external IP, country flag and a color-coded VPN status icon.
- Tailscale icon in the top bar when Tailscale is connected.
- Popup with external IP details, VPN status, DNS servers with leak detection, routing mode, all active connections, Tailscale status and system proxy settings.
- Preferences for panel position, visible panel elements, IP masking and refresh interval.
