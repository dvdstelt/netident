# Contributing to NetIdent

## Prerequisites

- GNOME Shell 45+ (Fedora 39+, Ubuntu 24.04+, etc.)
- `glib-compile-schemas` (usually part of `glib2-devel` or `libglib2.0-dev`)
- `make`

## Project structure

```
netident@compilesoftware.nl/
  metadata.json           Extension metadata and GNOME version compatibility
  Makefile                Build, install, and package targets
  src/
    extension.js          Main extension: panel indicator and popup dashboard
    networkManager.js     NetworkManager client wrapper with connection state signals
    connectionInfo.js     Queries NM for IPs, DNS, routes, DHCP/static and the primary device
    externalIp.js         External IP lookup via ipinfo.io, flag emoji, IP masking
    traffic.js            Download/upload rates from /proc/net/dev with a 60 second history
    probe.js              Latency, jitter and packet loss via ping
    speedtest.js          Speed test via Ookla CLI, speedtest-cli or curl + Cloudflare
    hostInfo.js           Device name via systemd-hostnamed
    tailscale.js          Tailscale status and on/off via subprocess
    proxyInfo.js          System proxy detection via org.gnome.system.proxy GSettings
    prefs.js              Preferences UI using libadwaita
    stylesheet-dark.css   Styling for the dark shell style (also installed as stylesheet.css)
    stylesheet-light.css  Styling for the light shell style (GNOME Shell 50+)
  schemas/
    org.gnome.shell.extensions.netident.gschema.xml
  icons/
    netident.png
    tailscale-symbolic.svg
```

## Build and install

```bash
cd netident@compilesoftware.nl
make install
gnome-extensions enable netident@compilesoftware.nl
```

On Wayland, you must log out and back in for GNOME Shell to load new extension code. There is no way around this.

## Makefile targets

| Target      | Description                                      |
|-------------|--------------------------------------------------|
| `make`      | Compile GSettings schemas                        |
| `make install` | Compile schemas and install to ~/.local/share/gnome-shell/extensions |
| `make enable`  | Enable the extension                          |
| `make disable` | Disable the extension                         |
| `make zip`     | Build a zip for extensions.gnome.org upload   |
| `make logs`    | Show recent GNOME Shell logs for this extension |
| `make uninstall` | Disable and remove the extension            |
| `make info`    | Show extension status                         |

## Development workflow

1. Edit files in `src/`
2. Run `make install`
3. Log out and back in
4. Run `make logs` to check for errors

## Architecture

The extension gathers data from multiple sources concurrently:

| Data                  | Source                                          |
|-----------------------|-------------------------------------------------|
| External IP + geo     | ipinfo.io/json via libsoup                      |
| Active connections    | NetworkManager GObject introspection (NM.Client) |
| VPN detection         | NM connection type: `vpn`, `wireguard`           |
| IP addresses, DNS     | NM.IPConfig per connection                       |
| Routes, split tunnel  | NM.IPConfig routes, default route detection      |
| DHCP vs static        | NM.ActiveConnection DHCP config presence         |
| Tailscale             | `tailscale status --json` via Gio.Subprocess     |
| Proxy                 | org.gnome.system.proxy GSettings                 |
| Live traffic          | /proc/net/dev byte counters, sampled every second |
| Latency, jitter, loss | `ping` to the probe host and the gateway, while the popup is open |
| Speed test            | Ookla `speedtest`, `speedtest-cli`, or `curl` against speed.cloudflare.com |
| Device name           | org.freedesktop.hostname1 (pretty or static hostname) |

The `NetworkManagerClient` emits connection state signals. On state change to ACTIVE, the extension fetches the external IP, Tailscale status and device name concurrently (async), then gathers NM connection info and proxy settings synchronously, and updates the popup in place. The popup is built once; detail rows under the three expanders are rebuilt on every refresh.

Stylesheets: GNOME Shell 50 loads `stylesheet-dark.css` or `stylesheet-light.css` depending on the system color scheme and swaps them live. Older shells only look for `stylesheet.css`, so `make install` and `make zip` copy the dark variant under that name too.

## Publishing to extensions.gnome.org

1. Bump `version` (integer) in `metadata.json`
2. Run `make zip`
3. Upload `netident@compilesoftware.nl.zip` at https://extensions.gnome.org
4. Wait for review (usually a few days)
