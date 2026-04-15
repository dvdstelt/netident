import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {NetworkManagerClient, NetworkStatus} from './networkManager.js';
import {fetchExternalIp, getFlagEmoji, maskIp} from './externalIp.js';
import {gatherConnectionInfo} from './connectionInfo.js';
import {getTailscaleStatus} from './tailscale.js';
import {getProxySettings} from './proxyInfo.js';

class NetIdentIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(extension) {
        super(0.5, _('Network Identity'));
        this.menu.box.style = 'padding: 16px;';

        this._extension = extension;
        this._settings = extension.getSettings();
        this._ipData = null;
        this._vpnActive = false;
        this._tailscaleActive = false;
        this._refreshTimerId = null;

        // Soup session for HTTP requests
        const SESSION_TYPE = GLib.getenv('XDG_SESSION_TYPE') || 'unknown';
        const PACKAGE_VERSION = Config.PACKAGE_VERSION;
        this._session = new Soup.Session({
            user_agent: `NetIdent/1.0 (${SESSION_TYPE}; GNOME Shell/${PACKAGE_VERSION})`,
            timeout: 30,
        });

        // Panel box with status elements
        this._panelBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            style_class: 'panel-status-indicators-box',
        });
        this.add_child(this._panelBox);

        this._vpnIcon = new St.Icon({
            icon_name: 'changes-allow-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'system-status-icon netident-vpn-off',
        });

        this._ipLabel = new St.Label({
            text: _('...'),
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'system-status-icon',
        });

        this._flagLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'system-status-icon',
        });

        this._statusIcon = new St.Icon({
            icon_name: 'network-wired-acquiring-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'system-status-icon',
        });
        this._panelBox.add_child(this._statusIcon);

        // Connect to NM
        this._nm = new NetworkManagerClient();
        this._nm.connectObject('connection-state', this._onConnectionState.bind(this), this);

        // Settings connections
        this._settings.connectObject(
            'changed::show-ip-in-panel', () => this._updatePanelElements(),
            'changed::show-flag-in-panel', () => this._updatePanelElements(),
            'changed::show-vpn-icon-in-panel', () => this._updatePanelElements(),
            'changed::mask-ip', () => this._updatePanelElements(),
            'changed::refresh-interval', () => this._resetRefreshTimer(),
            this);

        this._updatePanelElements();
    }

    _onConnectionState(_self, state) {
        if (state === NetworkStatus.ACTIVATING) {
            this._session.abort();
            this._showLoading();
        } else if (state === NetworkStatus.ACTIVE) {
            this._refresh();
        } else if (state === NetworkStatus.INACTIVE) {
            this._showOffline();
        }
    }

    _showLoading() {
        this._showStatusIcon('network-wired-acquiring-symbolic');
        this._ipLabel.text = _('...');
        this.menu.removeAll();
        this._addMenuItem(_('Loading...'));
    }

    _showOffline() {
        this._showStatusIcon('network-offline-symbolic');
        this._ipLabel.text = _('Offline');
        this._flagLabel.text = '';
        this._vpnActive = false;
        this._tailscaleActive = false;
        this.menu.removeAll();
        this._addMenuItem(_('No connection'));
    }

    _showStatusIcon(iconName) {
        // Clear panel and show only the status icon
        for (const child of [this._statusIcon, this._vpnIcon, this._ipLabel, this._flagLabel]) {
            if (this._panelBox.contains(child))
                this._panelBox.remove_child(child);
        }
        this._statusIcon.icon_name = iconName;
        this._panelBox.add_child(this._statusIcon);
    }

    async _refresh() {
        if (this._refreshing)
            return;
        this._refreshing = true;

        this._showLoading();
        this._stopRefreshTimer();

        // Gather all data concurrently
        const [ipResult, tailscaleResult] = await Promise.all([
            fetchExternalIp(this._session),
            getTailscaleStatus(),
        ]);

        // These are synchronous
        const connInfo = this._nm.client
            ? gatherConnectionInfo(this._nm.client)
            : null;
        const proxyInfo = getProxySettings();

        // Update panel
        this._ipData = ipResult.data;
        if (this._ipData) {
            this._vpnActive = connInfo?.vpnActive || false;
            this._tailscaleActive = tailscaleResult?.running || false;

            this._flagLabel.text = getFlagEmoji(this._ipData.country || '');
            this._updatePanelElements();
        } else {
            this._showStatusIcon('dialog-warning-symbolic');
            this._ipLabel.text = _('Error');
        }

        this._buildMenu(this._ipData, connInfo, tailscaleResult, proxyInfo);
        this._startRefreshTimer();
        this._refreshing = false;
    }

    _updatePanelElements() {
        // Remove all dynamic elements (including status icon)
        for (const child of [this._statusIcon, this._vpnIcon, this._ipLabel, this._flagLabel]) {
            if (this._panelBox.contains(child))
                this._panelBox.remove_child(child);
        }

        if (this._settings.get_boolean('show-vpn-icon-in-panel')) {
            if (this._vpnActive) {
                // VPN active: lock icon, green (priority over Tailscale)
                this._vpnIcon.gicon = null;
                this._vpnIcon.icon_name = 'changes-prevent-symbolic';
                this._vpnIcon.style_class = 'system-status-icon netident-vpn-on';
            } else if (this._tailscaleActive) {
                // Tailscale active (no VPN): tailscale icon, green
                this._vpnIcon.icon_name = '';
                this._vpnIcon.gicon = Gio.icon_new_for_string(
                    `${this._extension.path}/icons/tailscale-symbolic.svg`);
                this._vpnIcon.style_class = 'system-status-icon netident-vpn-on';
            } else {
                // Unprotected: unlock icon, red
                this._vpnIcon.gicon = null;
                this._vpnIcon.icon_name = 'changes-allow-symbolic';
                this._vpnIcon.style_class = 'system-status-icon netident-vpn-off';
            }
            this._panelBox.add_child(this._vpnIcon);
        }

        if (this._settings.get_boolean('show-ip-in-panel')) {
            const ip = this._ipData?.ip || '';
            this._ipLabel.text = this._settings.get_boolean('mask-ip')
                ? maskIp(ip) : ip;
            this._panelBox.add_child(this._ipLabel);
        }

        if (this._settings.get_boolean('show-flag-in-panel'))
            this._panelBox.add_child(this._flagLabel);
    }

    _buildMenu(ipData, connInfo, tailscaleInfo, proxyInfo) {
        this.menu.removeAll();

        if (!ipData) {
            this._addMenuItem(_('No connection data available'));
            return;
        }

        // --- External IP Section ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('External IP')));
        this._addInfoRow(_('IP'), ipData.ip || _('Unknown'));
        if (ipData.hostname)
            this._addInfoRow(_('Hostname'), ipData.hostname);
        if (ipData.org)
            this._addInfoRow(_('Org'), ipData.org);
        if (ipData.city || ipData.region || ipData.country) {
            const location = [ipData.city, ipData.region, ipData.country]
                .filter(Boolean).join(', ');
            this._addInfoRow(_('Location'), location);
        }
        if (ipData.timezone)
            this._addInfoRow(_('Timezone'), ipData.timezone);

        // --- VPN Status ---
        if (connInfo) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const vpnLabel = connInfo.vpnActive
                ? `${_('On')}: ${connInfo.vpnName}` : _('Off');
            const vpnItem = this._addInfoRow(_('VPN'), vpnLabel);
            const vpnClass = connInfo.vpnActive ? 'netident-vpn-on' : 'netident-vpn-off';
            vpnItem.label.style_class = vpnClass;
        }

        // --- DNS Section ---
        if (connInfo?.dns) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('DNS')));

            const {dns} = connInfo;
            for (const server of dns.allServers)
                this._addInfoRow(_('Server'), server);

            if (dns.hasVpn) {
                const leakText = dns.dnsLeak ? _('Possible leak!') : _('OK (VPN DNS)');
                const leakItem = this._addInfoRow(_('DNS Leak'), leakText);
                leakItem.label.style_class = dns.dnsLeak ? 'netident-dns-leak' : 'netident-dns-ok';
            }
        }

        // --- Routing Section ---
        if (connInfo?.routing) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Routing')));
            this._addInfoRow(_('Mode'), connInfo.routing.mode);
            if (connInfo.routing.defaultRouteInterface)
                this._addInfoRow(_('Default via'), connInfo.routing.defaultRouteInterface);
        }

        // --- Network Interfaces ---
        if (connInfo?.connections?.length > 0) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Connections')));

            for (const conn of connInfo.connections) {
                const typeIcon = conn.isVpn ? '\u{1f512}' : '\u{1f310}';
                const connSub = new PopupMenu.PopupSubMenuMenuItem(
                    `${typeIcon} ${conn.id} (${conn.type})`);
                this.menu.addMenuItem(connSub);

                if (conn.interfaces.length > 0)
                    this._addInfoRowTo(connSub.menu, _('Interface'), conn.interfaces.join(', '));

                for (const addr of conn.ipv4)
                    this._addInfoRowTo(connSub.menu, _('IPv4'), addr);

                for (const addr of conn.ipv6)
                    this._addInfoRowTo(connSub.menu, _('IPv6'), addr);

                if (conn.dnsServers.length > 0)
                    this._addInfoRowTo(connSub.menu, _('DNS'), conn.dnsServers.join(', '));

                this._addInfoRowTo(connSub.menu, _('Config'), conn.dhcp ? 'DHCP' : _('Static'));
            }
        }

        // --- Tailscale Section ---
        if (tailscaleInfo?.available) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Tailscale')));
            this._addInfoRow(_('Status'), tailscaleInfo.backendState);

            if (tailscaleInfo.running) {
                if (tailscaleInfo.hostname)
                    this._addInfoRow(_('Hostname'), tailscaleInfo.hostname);
                if (tailscaleInfo.tailscaleIp)
                    this._addInfoRow(_('Tailscale IP'), tailscaleInfo.tailscaleIp);
                if (tailscaleInfo.currentTailnet)
                    this._addInfoRow(_('Tailnet'), tailscaleInfo.currentTailnet);
                if (tailscaleInfo.exitNode) {
                    const exitText = tailscaleInfo.exitNode.name || _('Active');
                    this._addInfoRow(_('Exit Node'), exitText);
                }
                if (tailscaleInfo.magicDnsSuffix)
                    this._addInfoRow(_('MagicDNS'), tailscaleInfo.magicDnsSuffix);
                this._addInfoRow(_('Peers'), `${tailscaleInfo.peerCount}`);
            }
        }

        // --- Proxy Section ---
        if (proxyInfo?.enabled) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Proxy')));
            this._addInfoRow(_('Mode'), proxyInfo.mode);

            if (proxyInfo.proxies) {
                for (const proxy of proxyInfo.proxies)
                    this._addInfoRow(proxy.type, `${proxy.host}:${proxy.port}`);
            }
            if (proxyInfo.autoConfigUrl)
                this._addInfoRow(_('PAC URL'), proxyInfo.autoConfigUrl);
        }

        // --- Buttons ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const buttonsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(buttonsItem);

        const buttonsBox = new St.BoxLayout({
            style_class: 'netident-buttons',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        buttonsItem.add_child(buttonsBox);

        const copyBtn = new St.Button({
            style_class: 'netident-icon-button',
            child: new St.Icon({icon_name: 'edit-copy-symbolic', icon_size: 16}),
            reactive: true,
            can_focus: true,
        });
        copyBtn.connect('clicked', () => {
            if (ipData?.ip) {
                St.Clipboard.get_default().set_text(
                    St.ClipboardType.CLIPBOARD, ipData.ip);
            }
        });
        buttonsBox.add_child(copyBtn);

        const refreshBtn = new St.Button({
            style_class: 'netident-icon-button',
            child: new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 16}),
            reactive: true,
            can_focus: true,
        });
        refreshBtn.connect('clicked', () => this._refresh());
        buttonsBox.add_child(refreshBtn);

        const settingsBtn = new St.Button({
            style_class: 'netident-icon-button',
            child: new St.Icon({icon_name: 'applications-system-symbolic', icon_size: 16}),
            reactive: true,
            can_focus: true,
        });
        settingsBtn.connect('clicked', () => {
            this._extension.openPreferences();
            this.menu.toggle();
        });
        buttonsBox.add_child(settingsBtn);
    }

    _addMenuItem(text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
        this.menu.addMenuItem(item);
        return item;
    }

    _addInfoRow(key, value) {
        return this._addInfoRowTo(this.menu, key, value);
    }

    _addInfoRowTo(menu, key, value) {
        const item = new PopupMenu.PopupMenuItem('', {reactive: true});
        item.remove_child(item.label);

        const keyLabel = new St.Label({
            text: `${key}:`,
            style_class: 'netident-key',
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.add_child(keyLabel);

        item.label = new St.Label({
            text: value || '',
            style_class: 'netident-value',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        item.add_child(item.label);

        item.connect('activate', () => {
            if (value)
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, value);
        });

        menu.addMenuItem(item);
        return item;
    }

    _startRefreshTimer() {
        this._stopRefreshTimer();
        const interval = this._settings.get_int('refresh-interval');
        this._refreshTimerId = GLib.timeout_add_seconds(0, interval, () => {
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopRefreshTimer() {
        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = null;
        }
    }

    _resetRefreshTimer() {
        if (this._refreshTimerId)
            this._startRefreshTimer();
    }

    disable() {
        this._stopRefreshTimer();
        this._session.abort();
        this._session = null;
        this._nm.destroy();
        this._nm = null;
        this._settings.disconnectObject(this);
        this._settings = null;

        // Manually destroy elements that may have been removed from parent
        this._statusIcon.destroy();
        this._vpnIcon.destroy();
        this._ipLabel.destroy();
        this._flagLabel.destroy();
    }
}

export default class NetIdentExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new NetIdentIndicator(this);

        this._settings.connectObject(
            'changed::position-in-panel', () => this._updatePanelPosition(),
            'changed::position-in-panel-offset', () => this._updatePanelPosition(),
            this);

        this._updatePanelPosition();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._settings = null;
        this._indicator?.disable();
        this._indicator?.destroy();
        this._indicator = null;
    }

    _updatePanelPosition() {
        const uuid = this.metadata.uuid;
        if (Main.panel.statusArea[uuid])
            Main.panel.statusArea[uuid] = null;

        const panelBox = this._settings.get_string('position-in-panel');
        const offset = this._settings.get_int('position-in-panel-offset');
        Main.panel.addToStatusArea(uuid, this._indicator, offset, panelBox);
    }
}
