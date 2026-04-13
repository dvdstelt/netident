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
    extension.js          Main extension: panel indicator and popup menu
    networkManager.js     NetworkManager client wrapper with connection state signals
    connectionInfo.js     Queries NM for IPs, DNS, routes, DHCP/static per connection
    externalIp.js         External IP lookup via ipinfo.io, flag emoji, IP masking
    tailscale.js          Tailscale status via subprocess (tailscale status --json)
    proxyInfo.js          System proxy detection via org.gnome.system.proxy GSettings
    prefs.js              Preferences UI using libadwaita
    stylesheet.css        Extension styling
  schemas/
    org.gnome.shell.extensions.netident.gschema.xml
  icons/
    netident-logo.svg
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

The `NetworkManagerClient` emits connection state signals. On state change to ACTIVE, the extension fetches external IP and Tailscale status concurrently (async), then gathers NM connection info and proxy settings synchronously, and rebuilds the popup menu.

## Publishing to extensions.gnome.org

1. Bump `version` (integer) in `metadata.json`
2. Run `make zip`
3. Upload `netident@compilesoftware.nl.zip` at https://extensions.gnome.org
4. Wait for review (usually a few days)
