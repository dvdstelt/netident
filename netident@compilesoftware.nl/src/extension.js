import Cairo from 'cairo';
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

import {Extension, gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {NetworkManagerClient, NetworkStatus} from './networkManager.js';
import {fetchExternalIp, getFlagEmoji, maskIp} from './externalIp.js';
import {gatherConnectionInfo, getPrimaryDeviceInfo} from './connectionInfo.js';
import {getTailscaleStatus, setTailscaleState} from './tailscale.js';
import {getProxySettings} from './proxyInfo.js';
import {TrafficMonitor, formatBytes, formatRate, formatRatePair} from './traffic.js';
import {pingHost} from './probe.js';
import {runSpeedTest} from './speedtest.js';
import {getDeviceName} from './hostInfo.js';

const PROBE_INTERVAL_SECONDS = 15;
const PROBE_COUNT = 5;
const GATEWAY_PROBE_COUNT = 3;
const FOOTER_MESSAGE_SECONDS = 3;

const DOWN_ARROW = '↓';
const UP_ARROW = '↑';
const DOT = ' · ';

// St.BoxLayout gained `orientation` in GNOME 48 and deprecated `vertical`.
const HAS_ORIENTATION = !!St.BoxLayout.find_property?.('orientation');

function vbox(params = {}) {
    const orientation = HAS_ORIENTATION
        ? {orientation: Clutter.Orientation.VERTICAL}
        : {vertical: true};
    return new St.BoxLayout({...orientation, ...params});
}

function hbox(params = {}) {
    return new St.BoxLayout(params);
}

function label(text, styleClass, params = {}) {
    return new St.Label({
        text: text ?? '',
        style_class: styleClass,
        y_align: Clutter.ActorAlign.CENTER,
        ...params,
    });
}

function spacer() {
    return new St.Widget({x_expand: true});
}

function formatMs(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms))
        return '–';
    if (ms < 1)
        return '<1';
    return `${Math.round(ms)}`;
}

function formatMbps(bytesPerSecond) {
    const mbps = bytesPerSecond * 8 / 1e6;
    return mbps >= 100 ? `${Math.round(mbps)}` : mbps.toFixed(1);
}

function countryName(code) {
    if (!code)
        return '';
    try {
        return new Intl.DisplayNames(undefined, {type: 'region'}).of(code.toUpperCase()) || code;
    } catch {
        return code;
    }
}

function lookupColor(themeNode, name, fallback) {
    const [found, color] = themeNode.lookup_color(name, false);
    if (!found)
        return fallback;
    return [color.red / 255, color.green / 255, color.blue / 255];
}

class NetIdentIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(extension) {
        super(0.5, _('Network Identity'));
        this.menu.box.add_style_class_name('netident-menu');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._ipData = null;
        this._connInfo = null;
        this._device = null;
        this._tailscale = null;
        this._deviceName = null;
        this._vpnActive = false;
        this._tailscaleActive = false;
        this._panelShowsStatus = true;
        this._refreshTimerId = null;
        this._probeTimerId = null;
        this._footerTimerId = null;
        this._probing = false;
        this._speedTesting = false;
        this._speedResultText = '';

        const SESSION_TYPE = GLib.getenv('XDG_SESSION_TYPE') || 'unknown';
        const PACKAGE_VERSION = Config.PACKAGE_VERSION;
        this._session = new Soup.Session({
            user_agent: `NetIdent/1.0 (${SESSION_TYPE}; GNOME Shell/${PACKAGE_VERSION})`,
            timeout: 30,
        });

        this._buildPanel();
        this._buildMenu();

        this._traffic = new TrafficMonitor();
        this._traffic.connectObject('updated', () => this._onTrafficUpdated(), this);
        this._traffic.start(1000);

        this._nm = new NetworkManagerClient();
        this._nm.connectObject('connection-state', this._onConnectionState.bind(this), this);

        this._settings.connectObject(
            'changed::show-ip-in-panel', () => this._updatePanelElements(),
            'changed::show-flag-in-panel', () => this._updatePanelElements(),
            'changed::show-vpn-icon-in-panel', () => this._updatePanelElements(),
            'changed::show-traffic-in-panel', () => this._updatePanelElements(),
            'changed::mask-ip', () => this._updatePanelElements(),
            'changed::refresh-interval', () => this._resetRefreshTimer(),
            'changed::probe-host', () => this._onProbeHostChanged(),
            this);

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._onMenuOpened();
            else
                this._onMenuClosed();
        });
    }

    // --- Panel -----------------------------------------------------------

    _buildPanel() {
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

        this._rateLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'system-status-icon netident-panel-rate',
        });

        this._ipLabel = new St.Label({
            text: '',
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
    }

    _panelChildren() {
        return [this._statusIcon, this._vpnIcon, this._rateLabel, this._ipLabel, this._flagLabel];
    }

    _clearPanel() {
        for (const child of this._panelChildren()) {
            if (this._panelBox.contains(child))
                this._panelBox.remove_child(child);
        }
    }

    _showStatusIcon(iconName) {
        this._panelShowsStatus = true;
        this._clearPanel();
        this._statusIcon.icon_name = iconName;
        this._panelBox.add_child(this._statusIcon);
    }

    _updatePanelElements() {
        if (this._panelShowsStatus)
            return;

        this._clearPanel();

        if (this._settings.get_boolean('show-vpn-icon-in-panel')) {
            if (this._vpnActive) {
                this._vpnIcon.gicon = null;
                this._vpnIcon.icon_name = 'network-vpn-symbolic';
                this._vpnIcon.style_class = 'system-status-icon';
            } else if (this._tailscaleActive) {
                this._vpnIcon.icon_name = '';
                this._vpnIcon.gicon = Gio.icon_new_for_string(
                    `${this._extension.path}/icons/tailscale-symbolic.svg`);
                this._vpnIcon.style_class = 'system-status-icon';
            } else {
                this._vpnIcon.gicon = null;
                this._vpnIcon.icon_name = 'changes-allow-symbolic';
                this._vpnIcon.style_class = 'system-status-icon netident-vpn-off';
            }
            this._panelBox.add_child(this._vpnIcon);
        }

        if (this._settings.get_boolean('show-traffic-in-panel')) {
            this._rateLabel.text = formatRatePair(this._traffic.rxRate, this._traffic.txRate);
            this._panelBox.add_child(this._rateLabel);
        }

        if (this._settings.get_boolean('show-ip-in-panel')) {
            const ip = this._ipData?.ip || '';
            this._ipLabel.text = this._settings.get_boolean('mask-ip') ? maskIp(ip) : ip;
            this._panelBox.add_child(this._ipLabel);
        }

        if (this._settings.get_boolean('show-flag-in-panel')) {
            this._flagLabel.text = getFlagEmoji(this._ipData?.country || '');
            this._panelBox.add_child(this._flagLabel);
        }
    }

    // --- Menu structure --------------------------------------------------

    _buildMenu() {
        const box = this.menu.box;

        // Header: link type, device name, link speed, online badge
        const header = hbox({style_class: 'netident-section netident-header'});
        this._headerIcon = new St.Icon({
            icon_name: 'network-wired-symbolic',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(new St.Bin({
            style_class: 'netident-header-icon',
            child: this._headerIcon,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const titles = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._titleLabel = label(_('Connecting…'), 'netident-title');
        this._subtitleLabel = label('', 'netident-dim');
        titles.add_child(this._titleLabel);
        titles.add_child(this._subtitleLabel);
        header.add_child(titles);

        const badge = hbox({style_class: 'netident-badge', y_align: Clutter.ActorAlign.CENTER});
        this._statusDot = new St.Widget({
            style_class: 'netident-dot netident-dot-warning',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusLabel = label(_('Connecting'), 'netident-dim');
        badge.add_child(this._statusDot);
        badge.add_child(this._statusLabel);
        header.add_child(badge);
        box.add_child(header);

        // Live traffic
        const trafficHeading = hbox({style_class: 'netident-section'});
        trafficHeading.add_child(label(_('Live traffic').toUpperCase(), 'netident-section-label'));
        trafficHeading.add_child(spacer());
        trafficHeading.add_child(label(_('Last 60 seconds'), 'netident-caption'));
        box.add_child(trafficHeading);

        const cardWrap = new St.Bin({style_class: 'netident-section', x_expand: true});
        const card = vbox({style_class: 'netident-card', x_expand: true});
        cardWrap.child = card;

        const statsRow = hbox({style_class: 'netident-card-row'});
        this._downStat = this._buildStat(DOWN_ARROW, _('Download'));
        this._upStat = this._buildStat(UP_ARROW, _('Upload'));
        statsRow.add_child(this._downStat.box);
        statsRow.add_child(this._upStat.box);
        card.add_child(statsRow);

        this._graph = new St.DrawingArea({style_class: 'netident-graph', x_expand: true});
        this._graph.connect('repaint', area => this._drawGraph(area));
        card.add_child(this._graph);

        const totals = hbox({style_class: 'netident-totals'});
        this._downTotal = label(`${DOWN_ARROW}0 B`, null);
        this._upTotal = label(`${UP_ARROW}0 B`, null);
        totals.add_child(this._downTotal);
        totals.add_child(this._upTotal);
        totals.add_child(spacer());
        totals.add_child(label(_('This session'), null));
        card.add_child(totals);
        box.add_child(cardWrap);

        // Latency, jitter, packet loss
        const metrics = hbox({style_class: 'netident-metrics'});
        this._latencyMetric = this._buildMetric(_('Internet latency'), 'ms');
        this._jitterMetric = this._buildMetric(_('Jitter'), 'ms');
        this._lossMetric = this._buildMetric(_('Packet loss'), '%');
        metrics.add_child(this._latencyMetric.box);
        metrics.add_child(this._jitterMetric.box);
        metrics.add_child(this._lossMetric.box);
        box.add_child(metrics);

        const probeRow = hbox({style_class: 'netident-section'});
        this._probeLabel = label('', 'netident-caption');
        this._gatewayLabel = label('', 'netident-caption');
        probeRow.add_child(this._probeLabel);
        probeRow.add_child(spacer());
        probeRow.add_child(this._gatewayLabel);
        box.add_child(probeRow);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Public IP
        this._ipItem = new PopupMenu.PopupBaseMenuItem({style_class: 'netident-ip-row'});
        const ipColumn = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._ipHeading = label(_('Public IP').toUpperCase(), 'netident-section-label');
        this._ipValue = label('–', 'netident-ip');
        this._ipDetail = label('', 'netident-caption');
        ipColumn.add_child(this._ipHeading);
        ipColumn.add_child(this._ipValue);
        ipColumn.add_child(this._ipDetail);
        this._ipItem.add_child(ipColumn);
        this._ipItem.add_child(new St.Icon({
            icon_name: 'edit-copy-symbolic',
            style_class: 'popup-menu-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._ipItem.connect('activate', () => this._copyPublicIp());
        this.menu.addMenuItem(this._ipItem);

        // Expandable detail rows
        this._routeItem = this._buildExpander(_('Internet route'));
        this.menu.addMenuItem(this._routeItem);

        this._tailscaleItem = this._buildExpander(_('Tailscale'), true);
        this._tailscaleItem.icon.gicon = Gio.icon_new_for_string(
            `${this._extension.path}/icons/tailscale-symbolic.svg`);
        this.menu.addMenuItem(this._tailscaleItem);

        this._connectionsItem = this._buildExpander(_('Connection details'));
        this.menu.addMenuItem(this._connectionsItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Buttons
        const buttons = hbox({style_class: 'netident-buttons'});

        const speedContent = hbox({y_align: Clutter.ActorAlign.CENTER});
        speedContent.add_child(new St.Icon({
            icon_name: 'power-profile-performance-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._speedLabel = label(_('Run speed test'), null);
        speedContent.add_child(this._speedLabel);
        this._speedButton = new St.Button({
            style_class: 'netident-pill-button',
            child: speedContent,
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._speedButton.connect('clicked', () => this._onSpeedTestClicked());
        buttons.add_child(this._speedButton);
        buttons.add_child(spacer());

        const refreshButton = this._buildIconButton('view-refresh-symbolic', _('Refresh'));
        refreshButton.connect('clicked', () => this._refresh(true));
        buttons.add_child(refreshButton);

        const settingsButton = this._buildIconButton('emblem-system-symbolic', _('Settings'));
        settingsButton.connect('clicked', () => {
            this._extension.openPreferences();
            this.menu.close();
        });
        buttons.add_child(settingsButton);
        box.add_child(buttons);

        this._footer = label('', 'netident-footer', {visible: false});
        box.add_child(this._footer);
    }

    _buildStat(arrow, name) {
        const box = vbox({style_class: 'netident-stat', x_expand: true});
        const heading = hbox({style_class: 'netident-stat-label'});
        heading.add_child(label(arrow, null));
        heading.add_child(label(name, null));
        box.add_child(heading);

        const valueRow = hbox({style_class: 'netident-stat-value'});
        const value = label('0', 'netident-big-number', {y_align: Clutter.ActorAlign.END});
        const unit = label('KB/s', 'netident-unit', {y_align: Clutter.ActorAlign.END});
        valueRow.add_child(value);
        valueRow.add_child(unit);
        box.add_child(valueRow);

        return {box, value, unit};
    }

    _buildMetric(name, unitText) {
        const box = vbox({style_class: 'netident-stat', x_expand: true});
        box.add_child(label(name, 'netident-caption'));
        const valueRow = hbox({style_class: 'netident-stat-value'});
        const value = label('–', 'netident-metric-value', {y_align: Clutter.ActorAlign.END});
        valueRow.add_child(value);
        valueRow.add_child(label(unitText, 'netident-unit', {y_align: Clutter.ActorAlign.END}));
        box.add_child(valueRow);
        return {box, value};
    }

    _buildExpander(text, wantIcon = false) {
        const item = new PopupMenu.PopupSubMenuMenuItem(text, wantIcon);
        item.status = label('', 'netident-status');
        if (item._triangleBin)
            item.insert_child_below(item.status, item._triangleBin);
        else
            item.add_child(item.status);
        return item;
    }

    _buildIconButton(iconName, accessibleName) {
        return new St.Button({
            style_class: 'netident-icon-button',
            child: new St.Icon({icon_name: iconName}),
            reactive: true,
            can_focus: true,
            accessible_name: accessibleName,
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    // --- Data refresh ----------------------------------------------------

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
        this._setBadge('warning', _('Connecting'));
    }

    _showOffline() {
        this._showStatusIcon('network-offline-symbolic');
        this._vpnActive = false;
        this._tailscaleActive = false;
        this._titleLabel.text = _('No connection');
        this._subtitleLabel.text = this._deviceName || '';
        this._setBadge('offline', _('Offline'));
        this._traffic.setInterface(null);
    }

    async _refresh(silent = false) {
        if (this._refreshing)
            return;
        this._refreshing = true;

        if (!silent)
            this._showLoading();
        this._stopRefreshTimer();

        const [ipResult, tailscaleResult, deviceName] = await Promise.all([
            fetchExternalIp(this._session),
            getTailscaleStatus(),
            getDeviceName(),
        ]);

        if (!this._settings)
            return;

        const client = this._nm.client;
        this._connInfo = client ? gatherConnectionInfo(client) : null;
        this._device = client ? getPrimaryDeviceInfo(client) : null;
        this._proxyInfo = getProxySettings();
        this._tailscale = tailscaleResult;
        this._deviceName = deviceName;
        this._ipData = ipResult.data;
        this._vpnActive = this._connInfo?.vpnActive || false;
        this._tailscaleActive = tailscaleResult?.running || false;

        this._traffic.setInterface(this._device?.iface || null);

        if (this._ipData) {
            this._panelShowsStatus = false;
            this._updatePanelElements();
        } else {
            this._showStatusIcon('dialog-warning-symbolic');
        }

        this._updateMenu(ipResult.error);
        this._startRefreshTimer();
        this._refreshing = false;
    }

    _updateMenu(ipError) {
        const device = this._device;
        const connInfo = this._connInfo;
        const tailscale = this._tailscale;

        // Header
        if (device) {
            this._headerIcon.icon_name = device.iconName;
            this._titleLabel.text = device.ssid
                ? `${device.title} ${DOT.trim()} ${device.ssid}`
                : device.title;
            const parts = [this._deviceName || device.iface];
            if (device.linkSpeedMbps)
                parts.push(_('%s link').format(this._formatLinkSpeed(device.linkSpeedMbps)));
            this._subtitleLabel.text = parts.join(DOT);
        } else {
            this._titleLabel.text = this._deviceName || _('Network');
            this._subtitleLabel.text = '';
        }

        switch (device?.connectivity) {
        case 'online':
            this._setBadge('online', _('Online'));
            break;
        case 'limited':
            this._setBadge('warning', _('Limited'));
            break;
        case 'portal':
            this._setBadge('warning', _('Captive portal'));
            break;
        case 'offline':
            this._setBadge('offline', _('Offline'));
            break;
        default:
            this._setBadge(this._ipData ? 'online' : 'warning', this._ipData ? _('Online') : _('Unknown'));
        }

        this._probeLabel.text = _('Probe: %s').format(this._settings.get_string('probe-host'));
        if (!this._gatewayLabel.text)
            this._gatewayLabel.text = _('Gateway –');

        // Public IP
        const ip = this._ipData?.ip;
        if (ip) {
            const family = ip.includes(':') ? 'IPv6' : 'IPv4';
            this._ipHeading.text = _('Public %s').format(family).toUpperCase();
            this._ipValue.text = ip;
            const org = this._ipData.org?.replace(/^AS\d+\s+/, '');
            const place = [this._ipData.city, countryName(this._ipData.country)]
                .filter(Boolean).join(', ');
            this._ipDetail.text = [org, place].filter(Boolean).join(DOT);
            this._ipItem.setSensitive(true);
        } else {
            this._ipHeading.text = _('Public IP').toUpperCase();
            this._ipValue.text = _('Unavailable');
            this._ipDetail.text = ipError || '';
            this._ipItem.setSensitive(false);
        }

        this._updateRouteItem(connInfo, tailscale);
        this._updateTailscaleItem(tailscale);
        this._updateConnectionsItem(connInfo);
        this._updateTrafficCard();
    }

    _formatLinkSpeed(mbps) {
        if (mbps >= 1000)
            return `${(mbps / 1000).toFixed(mbps % 1000 === 0 ? 0 : 1)} Gbps`;
        return `${mbps} Mbps`;
    }

    _setBadge(state, text) {
        this._statusDot.style_class = `netident-dot netident-dot-${state}`;
        this._statusLabel.text = text;
    }

    _updateRouteItem(connInfo, tailscale) {
        const item = this._routeItem;
        item.menu.removeAll();

        const exitNode = tailscale?.running ? tailscale.exitNode : null;
        if (connInfo?.vpnActive)
            item.status.text = `${_('VPN')}${DOT}${connInfo.vpnName}`;
        else if (exitNode?.name)
            item.status.text = `${_('Tailscale exit node')}${DOT}${exitNode.name}`;
        else
            item.status.text = `${_('Direct')}${DOT}${_('no VPN')}`;

        if (!connInfo) {
            this._addInfoRowTo(item.menu, _('VPN'), _('Unknown'));
            return;
        }

        const vpnRow = this._addInfoRowTo(item.menu, _('VPN'),
            connInfo.vpnActive ? `${_('On')}: ${connInfo.vpnName}` : _('Off'));
        vpnRow.label.add_style_class_name(connInfo.vpnActive ? 'netident-dns-ok' : 'netident-status');

        if (exitNode?.name)
            this._addInfoRowTo(item.menu, _('Exit node'), exitNode.name);

        if (connInfo.routing) {
            this._addInfoRowTo(item.menu, _('Routing'), connInfo.routing.mode);
            if (connInfo.routing.defaultRouteInterface)
                this._addInfoRowTo(item.menu, _('Default via'), connInfo.routing.defaultRouteInterface);
        }

        if (this._device?.gateway)
            this._addInfoRowTo(item.menu, _('Gateway'), this._device.gateway);

        if (connInfo.dns) {
            for (const server of connInfo.dns.allServers)
                this._addInfoRowTo(item.menu, _('DNS'), server);

            if (connInfo.dns.hasVpn) {
                const leak = connInfo.dns.dnsLeak;
                const leakRow = this._addInfoRowTo(item.menu, _('DNS leak'),
                    leak ? _('Possible leak!') : _('OK (VPN DNS)'));
                leakRow.label.add_style_class_name(leak ? 'netident-dns-leak' : 'netident-dns-ok');
            }
        }

        const proxy = this._proxyInfo;
        if (proxy?.enabled) {
            this._addInfoRowTo(item.menu, _('Proxy'), proxy.mode);
            for (const entry of proxy.proxies || [])
                this._addInfoRowTo(item.menu, entry.type, `${entry.host}:${entry.port}`);
            if (proxy.autoConfigUrl)
                this._addInfoRowTo(item.menu, _('PAC URL'), proxy.autoConfigUrl);
        }
    }

    _updateTailscaleItem(tailscale) {
        const item = this._tailscaleItem;
        item.menu.removeAll();

        if (!tailscale?.available) {
            item.status.text = _('Not installed');
            this._addInfoRowTo(item.menu, _('Status'), tailscale?.error || _('Not available'));
            return;
        }

        if (tailscale.running) {
            const peers = ngettext('%d peer', '%d peers', tailscale.peerCount).format(tailscale.peerCount);
            item.status.text = `${_('Connected')}${DOT}${peers}`;
        } else {
            item.status.text = tailscale.backendState;
        }

        const toggle = new PopupMenu.PopupSwitchMenuItem(_('Enabled'), tailscale.running);
        toggle.connect('toggled', (_item, state) => this._onTailscaleToggled(toggle, state));
        item.menu.addMenuItem(toggle);

        this._addInfoRowTo(item.menu, _('Status'), tailscale.backendState);

        if (!tailscale.running)
            return;

        if (tailscale.hostname)
            this._addInfoRowTo(item.menu, _('Hostname'), tailscale.hostname);
        if (tailscale.tailscaleIp)
            this._addInfoRowTo(item.menu, _('Tailscale IP'), tailscale.tailscaleIp);
        if (tailscale.dnsName)
            this._addInfoRowTo(item.menu, _('DNS name'), tailscale.dnsName.replace(/\.$/, ''));
        if (tailscale.currentTailnet)
            this._addInfoRowTo(item.menu, _('Tailnet'), tailscale.currentTailnet);
        if (tailscale.exitNode)
            this._addInfoRowTo(item.menu, _('Exit node'), tailscale.exitNode.name || _('Active'));
        if (tailscale.magicDnsSuffix)
            this._addInfoRowTo(item.menu, _('MagicDNS'), tailscale.magicDnsSuffix);
        this._addInfoRowTo(item.menu, _('Peers'), `${tailscale.peerCount}`);
    }

    _updateConnectionsItem(connInfo) {
        const item = this._connectionsItem;
        item.menu.removeAll();

        const connections = connInfo?.connections || [];
        const count = connections.length;
        item.status.text = ngettext('%d interface', '%d interfaces', count).format(count);

        if (count === 0) {
            this._addInfoRowTo(item.menu, _('Connections'), _('None'));
            return;
        }

        for (const conn of connections) {
            const typeIcon = conn.isVpn ? '\u{1f512}' : '\u{1f310}';
            const heading = new PopupMenu.PopupMenuItem(
                `${typeIcon} ${conn.id} (${conn.type})`, {reactive: false});
            item.menu.addMenuItem(heading);

            if (conn.interfaces.length > 0)
                this._addInfoRowTo(item.menu, _('Interface'), conn.interfaces.join(', '));
            for (const addr of conn.ipv4)
                this._addInfoRowTo(item.menu, _('IPv4'), addr);
            for (const addr of conn.ipv6)
                this._addInfoRowTo(item.menu, _('IPv6'), addr);
            if (conn.dnsServers.length > 0)
                this._addInfoRowTo(item.menu, _('DNS'), conn.dnsServers.join(', '));
            this._addInfoRowTo(item.menu, _('Config'), conn.dhcp ? 'DHCP' : _('Static'));
        }
    }

    // --- Live traffic ----------------------------------------------------

    _onTrafficUpdated() {
        if (!this._settings)
            return;

        if (!this._panelShowsStatus && this._settings.get_boolean('show-traffic-in-panel'))
            this._rateLabel.text = formatRatePair(this._traffic.rxRate, this._traffic.txRate);

        if (this.menu.isOpen)
            this._updateTrafficCard();
    }

    _updateTrafficCard() {
        const down = formatRate(this._traffic.rxRate);
        const up = formatRate(this._traffic.txRate);
        this._downStat.value.text = down.value;
        this._downStat.unit.text = down.unit;
        this._upStat.value.text = up.value;
        this._upStat.unit.text = up.unit;

        const rxTotal = formatBytes(this._traffic.sessionRx);
        const txTotal = formatBytes(this._traffic.sessionTx);
        this._downTotal.text = `${DOWN_ARROW}${rxTotal.value} ${rxTotal.unit}`;
        this._upTotal.text = `${UP_ARROW}${txTotal.value} ${txTotal.unit}`;

        this._graph.queue_repaint();
    }

    _drawGraph(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const node = area.get_theme_node();
        const downColor = lookupColor(node, '-netident-download-color', [0.38, 0.63, 0.92]);
        const upColor = lookupColor(node, '-netident-upload-color', [0.75, 0.38, 0.80]);

        const rx = this._traffic.rxHistory;
        const tx = this._traffic.txHistory;
        const peak = Math.max(1, ...rx, ...tx);
        const pad = 2;
        const stepX = width / Math.max(1, rx.length - 1);
        const yFor = value => height - pad - (value / peak) * (height - 2 * pad);

        const trace = series => {
            series.forEach((value, i) => {
                const x = i * stepX;
                const y = yFor(value);
                if (i === 0)
                    cr.moveTo(x, y);
                else
                    cr.lineTo(x, y);
            });
        };

        cr.setLineWidth(2);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.setLineCap(Cairo.LineCap.ROUND);

        trace(rx);
        cr.lineTo(width, height);
        cr.lineTo(0, height);
        cr.closePath();
        cr.setSourceRGBA(...downColor, 0.22);
        cr.fill();

        trace(rx);
        cr.setSourceRGBA(...downColor, 1);
        cr.stroke();

        trace(tx);
        cr.setSourceRGBA(...upColor, 1);
        cr.stroke();

        cr.$dispose();
    }

    // --- Latency probes --------------------------------------------------

    _onMenuOpened() {
        this._updateTrafficCard();
        this._runProbes();
        this._stopProbeTimer();
        this._probeTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            PROBE_INTERVAL_SECONDS, () => {
                this._runProbes();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _onMenuClosed() {
        this._stopProbeTimer();
        this._probeCancellable?.cancel();
    }

    _stopProbeTimer() {
        if (this._probeTimerId) {
            GLib.source_remove(this._probeTimerId);
            this._probeTimerId = null;
        }
    }

    _onProbeHostChanged() {
        this._probeLabel.text = _('Probe: %s').format(this._settings.get_string('probe-host'));
        if (this.menu.isOpen)
            this._runProbes();
    }

    async _runProbes() {
        if (this._probing)
            return;
        this._probing = true;

        const host = this._settings.get_string('probe-host');
        const gateway = this._device?.gateway || null;
        this._probeCancellable = new Gio.Cancellable();
        const cancellable = this._probeCancellable;

        const [internet, gw] = await Promise.all([
            pingHost(host, PROBE_COUNT, cancellable),
            gateway ? pingHost(gateway, GATEWAY_PROBE_COUNT, cancellable) : Promise.resolve(null),
        ]);

        this._probing = false;
        if (!this._settings || cancellable.is_cancelled())
            return;

        if (internet.ok) {
            this._latencyMetric.value.text = formatMs(internet.latency);
            this._jitterMetric.value.text = formatMs(internet.jitter);
            this._lossMetric.value.text = `${Math.round(internet.loss)}`;
        } else {
            this._latencyMetric.value.text = '–';
            this._jitterMetric.value.text = '–';
            this._lossMetric.value.text = '–';
        }

        if (gw?.ok && gw.latency !== null)
            this._gatewayLabel.text = _('Gateway %s ms').format(formatMs(gw.latency));
        else
            this._gatewayLabel.text = _('Gateway –');
    }

    // --- Actions ---------------------------------------------------------

    _copyPublicIp() {
        const ip = this._ipData?.ip;
        if (!ip)
            return;
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, ip);
        this._showFooter(_('Public IP copied to clipboard'), FOOTER_MESSAGE_SECONDS);
    }

    async _onSpeedTestClicked() {
        if (this._speedTesting)
            return;
        this._speedTesting = true;
        this._speedButton.add_style_pseudo_class('insensitive');

        const phases = {
            starting: _('Running speed test…'),
            download: _('Testing download…'),
            upload: _('Testing upload…'),
        };
        this._speedLabel.text = phases.starting;
        this._speedCancellable = new Gio.Cancellable();

        const result = await runSpeedTest(
            phase => {
                if (this._settings)
                    this._speedLabel.text = phases[phase] || phases.starting;
            },
            this._speedCancellable);

        if (!this._settings)
            return;

        this._speedTesting = false;
        this._speedButton.remove_style_pseudo_class('insensitive');
        this._speedLabel.text = _('Run speed test');

        if (result.ok) {
            const parts = [
                `${DOWN_ARROW} ${formatMbps(result.download)} Mbps`,
                `${UP_ARROW} ${formatMbps(result.upload)} Mbps`,
            ];
            if (result.latency !== null)
                parts.push(`${formatMs(result.latency)} ms`);
            parts.push(result.server ? `${result.provider} (${result.server})` : result.provider);
            this._speedResultText = parts.join(DOT);
            this._showFooter(this._speedResultText);
        } else {
            console.error(`NetIdent: speed test failed: ${result.error}`);
            this._showFooter(_('Speed test failed: %s').format(result.error), FOOTER_MESSAGE_SECONDS * 2);
        }
    }

    _showFooter(text, seconds = 0) {
        this._stopFooterTimer();
        this._footer.text = text;
        this._footer.visible = !!text;

        if (seconds > 0) {
            this._footerTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
                this._footerTimerId = null;
                this._footer.text = this._speedResultText;
                this._footer.visible = !!this._speedResultText;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _stopFooterTimer() {
        if (this._footerTimerId) {
            GLib.source_remove(this._footerTimerId);
            this._footerTimerId = null;
        }
    }

    async _onTailscaleToggled(toggle, up) {
        toggle.setStatus(up ? _('starting…') : _('stopping…'));

        const result = await setTailscaleState(up);

        if (!this._settings)
            return;

        if (!result.success) {
            Main.notify(_('NetIdent'),
                up ? _('Could not start Tailscale') : _('Could not stop Tailscale'));
            console.error(`NetIdent: tailscale ${up ? 'up' : 'down'} failed: ${result.error}`);
        }

        this._refresh(true);
    }

    _addInfoRowTo(menu, key, value) {
        const item = new PopupMenu.PopupMenuItem('', {reactive: true});
        item.remove_child(item.label);

        item.add_child(label(`${key}:`, 'netident-key'));
        item.label = label(value || '', 'netident-value', {x_expand: true});
        item.add_child(item.label);

        item.connect('activate', () => {
            if (value)
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, value);
        });

        menu.addMenuItem(item);
        return item;
    }

    // --- Timers ----------------------------------------------------------

    _startRefreshTimer() {
        this._stopRefreshTimer();
        const interval = this._settings.get_int('refresh-interval');
        this._refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refreshTimerId = null;
            this._refresh(true);
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
        this._stopProbeTimer();
        this._stopFooterTimer();
        this._probeCancellable?.cancel();
        this._speedCancellable?.cancel();
        this._session.abort();
        this._session = null;
        this._traffic.disconnectObject(this);
        this._traffic.destroy();
        this._traffic = null;
        this._nm.destroy();
        this._nm = null;
        this._settings.disconnectObject(this);
        this._settings = null;

        for (const child of this._panelChildren())
            child.destroy();
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
