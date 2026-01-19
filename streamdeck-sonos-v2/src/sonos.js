import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

/**
 * Sonos UPnP/SOAP API Client for Node.js
 */
export class Sonos {
    constructor() {
        this.host = null;
        this.port = 1400;
        this.coordinatorHost = null; // Cache the coordinator IP
    }

    connect(host, port = 1400, targetGroup = '') {
        this.host = host;
        this.port = port;
        this.targetGroup = targetGroup;
        this.coordinatorHost = null; // Reset coordinator cache when connecting to new speaker
        this.zoneGroupState = null;
    }

    isConnected() {
        return !!this.host;
    }

    extractHostFromLocation(location) {
        const match = location?.match(/http:\/\/([^:]+):/);
        return match ? match[1] : null;
    }

    // Get the group coordinator for this speaker
    async getGroupCoordinator() {
        if (this.coordinatorHost) {
            console.log(`Using cached coordinator: ${this.coordinatorHost}`);
            return this.coordinatorHost; // Return cached coordinator
        }

        this.zoneGroupState = null;

        const groups = await this.getAvailableGroups();
        const targetCoordinator = this.targetGroup
            ? groups.find(group => group.coordinator === this.targetGroup)
            : groups.find(group => group.members.some(member => member?.includes(this.host)));

        if (targetCoordinator?.coordinator) {
            this.coordinatorHost = targetCoordinator.coordinator;
            console.log(`✓ Found coordinator: ${this.coordinatorHost} (configured speaker: ${this.host})`);
            console.log(`  Group has ${targetCoordinator.members.length} member(s)`);
            return this.coordinatorHost;
        }

        // If we couldn't find coordinator or speaker is standalone, use the original host
        this.coordinatorHost = this.host;
        console.log(`Using configured speaker as coordinator: ${this.host}`);
        return this.host;
    }

    // Transport Control
    async executeAvTransport(action, params = {}) {
        const coordinator = await this.getGroupCoordinator();
        return this.executeActionOnHost(coordinator, 'AVTransport', action, params);
    }

    async executeAvTransportForGroup(action, params = {}) {
        const members = await this.getGroupMembers();
        if (!members.length) {
            return this.executeAvTransport(action, params);
        }

        const results = await Promise.allSettled(members.map((member) =>
            this.executeActionOnHost(member, 'AVTransport', action, params)
        ));
        const successes = results.filter((result) => result.status === 'fulfilled');
        if (!successes.length) {
            const reason = results.find((result) => result.status === 'rejected')?.reason;
            throw reason || new Error(`Failed to execute ${action} on group`);
        }
    }

    async getTransportInfo() {
        return this.executeAvTransport('GetTransportInfo');
    }

    async play() {
        return this.executeAvTransportForGroup('Play', { Speed: 1 });
    }

    async canPause() {
        const { CurrentTransportState } = await this.getTransportInfo();
        return CurrentTransportState === 'PLAYING';
    }

    async pause() {
        return this.executeAvTransportForGroup('Pause');
    }

    async stop() {
        return this.executeAvTransportForGroup('Stop');
    }

    async pauseWithFallback() {
        try {
            await this.pause();
        } catch (error) {
            await this.stop();
        }
    }

    async next() {
        return this.executeAvTransport('Next');
    }

    async previous() {
        return this.executeAvTransport('Previous');
    }

    async previousWithFallback() {
        try {
            await this.previous();
        } catch (error) {
            // Previous command not supported, just restart current track
            // Sonos doesn't support seeking to previous tracks via Seek command
            await this.seek('REL_TIME', '0:00:00');
        }
    }

    async getPositionInfo() {
        return this.executeAvTransport('GetPositionInfo');
    }

    async getTrackInfo() {
        const { RelTime: elapsed, TrackDuration: duration, TrackMetaData: metadata } = await this.getPositionInfo();
        const parsed = await this.parseTrackMetadata(metadata);
        return {
            ...parsed,
            elapsed,
            duration
        };
    }

    async parseTrackMetadata(metadata) {
        if (!metadata || metadata === 'NOT_IMPLEMENTED') {
            return {};
        }

        try {
            const parsed = await parseStringPromise(metadata, {
                explicitArray: false,
                tagNameProcessors: [(name) => name.replace(/^.*:/, '')]
            });

            const didl = parsed['DIDL-Lite'] || parsed.DIDL || {};
            const item = Array.isArray(didl.item) ? didl.item[0] : didl.item;
            if (!item) {
                return {};
            }

            const normalize = (value) => {
                if (Array.isArray(value)) {
                    return value[0];
                }
                if (value && typeof value === 'object' && '_' in value) {
                    return value._;
                }
                return value;
            };

            const artist = normalize(item.creator);
            const title = normalize(item.title);
            const streamContent = normalize(item.streamContent || item['r:streamContent']);
            let albumArtURI = normalize(item.albumArtURI);
            if (albumArtURI && !albumArtURI.startsWith('http')) {
                albumArtURI = `http://${this.host}:1400${albumArtURI}`;
            }

            return {
                artist,
                title,
                streamContent,
                albumArtURI
            };
        } catch (error) {
            console.log(`Failed to parse track metadata: ${error.message}`);
            return {};
        }
    }

    async getTransportSettings() {
        return this.executeAvTransport('GetTransportSettings');
    }

    async setPlayMode(playMode) {
        return this.executeAvTransport('SetPlayMode', { NewPlayMode: playMode });
    }

    async setPlayModeForGroup(playMode) {
        const members = await this.getGroupMembers();
        if (!members.length) {
            return this.setPlayMode(playMode);
        }

        const results = await Promise.allSettled(members.map((member) =>
            this.executeActionOnHost(member, 'AVTransport', 'SetPlayMode', { NewPlayMode: playMode })
        ));
        const successes = results.filter((result) => result.status === 'fulfilled');
        if (!successes.length) {
            const reason = results.find((result) => result.status === 'rejected')?.reason;
            throw reason || new Error('Failed to set play mode for group');
        }
    }

    async setAVTransportURI(uri, metadata = '') {
        return this.executeAvTransport('SetAVTransportURI', {
            CurrentURI: uri,
            CurrentURIMetaData: metadata
        });
    }

    async setLocalTransport(prefix, suffix = '') {
        const coordinatorIP = await this.getGroupCoordinator();
        // Get the UUID from zone group state
        const state = await this.getZoneGroupState();
        const groups = state.ZoneGroupState?.ZoneGroups?.[0]?.ZoneGroup || [];
        const groupList = Array.isArray(groups) ? groups : [groups];

        // Find the group containing our coordinator
        for (const group of groupList) {
            const members = group.ZoneGroupMember || [];
            const memberList = Array.isArray(members) ? members : [members];

            const coordinatorMember = memberList.find(m =>
                m.$.Location?.includes(coordinatorIP)
            );

            if (coordinatorMember && coordinatorMember.$.UUID) {
                return this.setAVTransportURI(`${prefix}:${coordinatorMember.$.UUID}${suffix}`);
            }
        }

        // Fallback - shouldn't reach here
        throw new Error('Could not find coordinator UUID');
    }

    async setServiceURI(uri, metadata) {
        // Radio streams can be set directly
        if (uri.startsWith('x-sonosapi-stream:')) {
            return this.setAVTransportURI(uri, metadata);
        }

        // For playlists/favorites, add to queue and play from there
        const result = await this.addURIToQueue(uri, metadata);
        const trackNr = result.FirstTrackNumberEnqueued;

        if (!trackNr) {
            throw new Error(`Failed to add URI "${uri}" to queue`);
        }

        // Switch source to queue
        await this.setLocalTransport('x-rincon-queue', '#0');

        // Seek to the first track in the playlist
        return this.seek('TRACK_NR', trackNr);
    }

    parseServiceURI(uri) {
        // This method is not used anymore - favorites come with the correct URI format
        return { uri, metadata: '' };
    }

    async seek(unit, target) {
        return this.executeAvTransport('Seek', { Unit: unit, Target: target });
    }

    async addURIToQueue(uri, metadata, position = 0, next = false) {
        // Queue operations must go to the coordinator
        return this.executeAvTransport('AddURIToQueue', {
            EnqueuedURI: uri,
            EnqueuedURIMetaData: metadata,
            DesiredFirstTrackNumberEnqueued: position,
            EnqueueAsNext: next ? '1' : '0'
        });
    }

    // Volume Control
    async getVolume() {
        const coordinator = await this.getGroupCoordinator();
        return this.executeActionOnHost(coordinator, 'RenderingControl', 'GetVolume', { Channel: 'Master' });
    }

    async setVolume(volume) {
        const members = await this.getGroupMembers();
        if (!members.length) {
            return this.executeAction('RenderingControl', 'SetVolume', {
                Channel: 'Master',
                DesiredVolume: volume
            });
        }

        await Promise.all(members.map(member => this.executeActionOnHost(member, 'RenderingControl', 'SetVolume', {
            Channel: 'Master',
            DesiredVolume: volume
        })));
    }

    async getMute() {
        return this.executeAction('RenderingControl', 'GetMute', { Channel: 'Master' });
    }

    async setMute(mute) {
        const members = await this.getGroupMembers();
        if (!members.length) {
            return this.executeAction('RenderingControl', 'SetMute', {
                Channel: 'Master',
                DesiredMute: mute ? '1' : '0'
            });
        }

        await Promise.all(members.map(member => this.executeActionOnHost(member, 'RenderingControl', 'SetMute', {
            Channel: 'Master',
            DesiredMute: mute ? '1' : '0'
        })));
    }

    // Zone Management
    async getZoneGroupState() {
        if (this.zoneGroupState) {
            return this.zoneGroupState;
        }

        const result = await this.executeAction('ZoneGroupTopology', 'GetZoneGroupState', {});
        const parsed = await parseStringPromise(result.ZoneGroupState, {
            explicitArray: true,
            mergeAttrs: false
        });
        this.zoneGroupState = parsed;
        return parsed;
    }

    collectGroupMembers(node, members) {
        if (!node) {
            return;
        }

        if (Array.isArray(node)) {
            node.forEach(item => this.collectGroupMembers(item, members));
            return;
        }

        if (typeof node === 'object') {
            if (node.$?.UUID && node.$?.Location) {
                members.push({
                    uuid: node.$.UUID,
                    location: node.$.Location,
                    name: node.$.ZoneName || node.$.ZoneGroupName
                });
            }

            Object.values(node).forEach(value => this.collectGroupMembers(value, members));
        }
    }

    async getAvailableGroups() {
        const state = await this.getZoneGroupState();
        const groups = state.ZoneGroupState?.ZoneGroups?.[0]?.ZoneGroup || [];
        const groupList = Array.isArray(groups) ? groups : [groups];

        return groupList.map((group) => {
            const members = [];
            this.collectGroupMembers(group, members);

            const uniqueMembers = members.filter((member, index, list) =>
                list.findIndex((item) => item.uuid === member.uuid) === index
            );

            const coordinatorUuid = group.$?.Coordinator;
            const coordinatorMember = uniqueMembers.find(member => member.uuid === coordinatorUuid)
                || uniqueMembers[0];
            const coordinator = this.extractHostFromLocation(coordinatorMember?.location)
                || this.host;
            const name = group.$?.ZoneGroupName || coordinatorMember?.name || coordinator;
            const memberHosts = uniqueMembers
                .map(member => this.extractHostFromLocation(member.location))
                .filter(Boolean);

            return {
                coordinator,
                name,
                members: [...new Set(memberHosts)]
            };
        });
    }

    async getGroupMembers() {
        const groups = await this.getAvailableGroups();
        const target = this.targetGroup
            ? groups.find(group => group.coordinator === this.targetGroup)
            : groups.find(group => group.members.some(member => member?.includes(this.host)));

        return target?.members || [];
    }

    // Browse Content
    async browse(type, term, categories, start = 0, count = 100) {
        let objectId = type;
        if (categories) {
            objectId += '/' + categories.map(c => encodeURIComponent(c)).join('/');
        }
        if (term) {
            objectId += ':' + encodeURIComponent(term);
        }

        const result = await this.executeAction('ContentDirectory', 'Browse', {
            ObjectID: objectId,
            BrowseFlag: 'BrowseDirectChildren',
            Filter: '*',
            StartingIndex: start,
            RequestedCount: count,
            SortCriteria: ''
        });

        const parsed = await parseStringPromise(result.Result, {
            explicitArray: true
        });

        const items = parsed['DIDL-Lite']?.item || [];
        return items.map(item => ({
            title: item['dc:title']?.[0] || '',
            uri: item.res?.[0]?._ || item.res?.[0] || '',
            metadata: item['r:resMD']?.[0] || '',
            albumArtURI: this.getAlbumArtURI(item)
        }));
    }

    getAlbumArtURI(item) {
        let albumArtURI = item['upnp:albumArtURI']?.[0];
        if (albumArtURI && !albumArtURI.startsWith('http')) {
            albumArtURI = `http://${this.host}:1400${albumArtURI}`;
        }
        return albumArtURI;
    }

    // Core SOAP execution
    // Execute action on a specific host (used for coordinator routing)
    async executeActionOnHost(host, service, action, params) {
        params.InstanceID = params.InstanceID ?? 0;

        const serviceMap = {
            'AVTransport': 'MediaRenderer/AVTransport',
            'RenderingControl': 'MediaRenderer/RenderingControl',
            'ZoneGroupTopology': 'ZoneGroupTopology',
            'ContentDirectory': 'MediaServer/ContentDirectory'
        };

        const baseUrl = serviceMap[service] || service;
        const url = `http://${host}:${this.port}/${baseUrl}/Control`;
        const soapAction = `"urn:schemas-upnp-org:service:${service}:1#${action}"`;

        const xmlParams = Object.keys(params)
            .map(key => `<${key}>${this.escapeXml(params[key])}</${key}>`)
            .join('');

        const request = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
    <s:Body>
        <u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:1">
            ${xmlParams}
        </u:${action}>
    </s:Body>
</s:Envelope>`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'SOAPAction': soapAction,
                'Content-Type': 'text/xml; charset=utf-8'
            },
            body: request
        });

        const responseText = await response.text();

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${responseText}`);
        }

        const result = await parseStringPromise(responseText, {
            explicitArray: false,
            tagNameProcessors: [(name) => name.replace(/^.*:/, '')] // Remove namespace prefixes
        });

        const responseBody = result.Envelope?.Body?.[`${action}Response`];
        return responseBody || {};
    }

    async executeAction(service, action, params) {
        if (!this.isConnected()) {
            throw new Error('Not connected to Sonos');
        }

        return this.executeActionOnHost(this.host, service, action, params);
    }

    escapeXml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}
