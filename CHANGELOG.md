# Changelog

All notable changes to NetIdent are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-26

### Added

- Tailscale devices page, opened from the Tailscale row with a slide animation. It lists this device, every online peer with its Tailscale IP, connection path (direct or relayed), OS and latency from `tailscale ping`, and the offline peers with when they were last seen. Peers that offer an exit node show a tag that switches the exit node on or off. A warning row offers to accept advertised subnet routes. A button opens the admin console.
- Notification when the public IP address changes, with the previous and new address. The last five previous addresses are listed under Internet route.
- Notification when a VPN connects or disconnects.
- Alert state in the top bar: a warning icon and orange rates when the latency probe loses packets or gets no reply while the connection reports online. The probe now also runs in the background once a minute.
- Interface picker for the traffic graph. Click the interface name above the graph to cycle through interfaces, or pick one in the preferences.
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
- VPN, routing, DNS and proxy details moved into the Internet route expander, connection details into their own expander, and the Tailscale details onto the Tailscale devices page.
- Clicking a value in the popup copies it and keeps the popup open.
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
