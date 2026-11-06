import GLib from 'gi://GLib';
import NM from 'gi://NM';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

export const NetworkStatus = {
    ACTIVATING: 0,
    ACTIVE: 1,
    INACTIVE: 2,
};

export class NetworkManagerClient extends EventEmitter {
    constructor() {
        super();
        this._mainConnection = null;
        this._connectionDelayId = null;
        NM.Client.new_async(null, this._onClientReady.bind(this));
    }

    get client() {
        return this._client;
    }

    _onClientReady(_obj, result) {
        this._client = NM.Client.new_finish(result);
        this._client.connectObject(
            'notify::primary-connection', () => this._syncMainConnection(),
            'notify::activating-connection', () => this._syncMainConnection(),
            'notify::active-connections', () => this._syncMainConnection(),
            'notify::connectivity', () => this._syncConnectivity(),
            this);
        this._syncMainConnection();
    }

    _syncMainConnection() {
        this.emit('connection-state', NetworkStatus.ACTIVATING);
        this._mainConnection?.disconnectObject(this);

        this._mainConnection =
            this._client.get_primary_connection() ||
            this._client.get_activating_connection();

        if (this._mainConnection) {
            this._mainConnection.connectObject(
                'notify::state', this._onMainConnectionStateChanged.bind(this),
                this);
            this._onMainConnectionStateChanged();
        }

        this._syncConnectivity();
    }

    _onMainConnectionStateChanged() {
        if (this._mainConnection.state === NM.ActiveConnectionState.ACTIVATED) {
            this.emit('connection-state', NetworkStatus.ACTIVATING);
            this._removeConnectionDelay();

            // Short delay to let all connections settle before querying details
            this._connectionDelayId = GLib.timeout_add(0, 2000, () => {
                this.emit('connection-state', NetworkStatus.ACTIVE);
                this._connectionDelayId = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _removeConnectionDelay() {
        if (this._connectionDelayId) {
            GLib.source_remove(this._connectionDelayId);
            this._connectionDelayId = null;
        }
    }

    _syncConnectivity() {
        if (!this._client)
            return;

        const activeConns = this._client.get_active_connections();
        if (activeConns.length < 1 || this._client.connectivity === NM.ConnectivityState.NONE)
            this.emit('connection-state', NetworkStatus.INACTIVE);

        if (!this._mainConnection ||
            this._mainConnection.state !== NM.ActiveConnectionState.ACTIVATED)
            this.emit('connection-state', NetworkStatus.INACTIVE);
    }

    destroy() {
        this._client?.disconnectObject(this);
        this._mainConnection?.disconnectObject(this);
        this._removeConnectionDelay();
        this._mainConnection = null;
        this._client = null;
    }
}
