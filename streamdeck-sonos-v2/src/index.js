import streamDeck from "@elgato/streamdeck";
import { Sonos } from "./sonos.js";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";

// Global Sonos instance
const sonos = new Sonos();

// Helper to ensure Sonos is connected
function ensureConnected() {
    if (!sonos.isConnected()) {
        throw new Error('Not connected to Sonos. Please configure your Sonos speaker IP in plugin settings.');
    }
}

// Initialize connection from global settings
streamDeck.settings.onDidReceiveGlobalSettings(({ settings }) => {
    streamDeck.logger.info('Received global settings:', JSON.stringify(settings));

    const host = settings.host || '';
    const port = parseInt(settings.port, 10) || 1400;
    const targetGroup = settings.targetGroup || '';

    if (!host) {
        streamDeck.logger.info('No host configured. Please configure a Sonos speaker IP in the global settings.');
        return;
    }

    sonos.connect(host, port, targetGroup);
    streamDeck.logger.info(`Connected to Sonos at ${host}:${port}`);
});

const DEFAULT_TITLE_PARAMS = {
    fontFamily: 'Arial',
    fontSize: 10,
    fontStyle: 'Bold',
    fontUnderline: false,
    showTitle: true,
    titleColor: '#ffffff'
};

const PLAYPAUSE_REFRESH_MS = 1000;
const playPauseTimers = new Map();
const playPauseSettings = new Map();
const LOG_DIR = join(process.cwd(), "logs");
const LOG_PATH = join(LOG_DIR, "runtime.log");
const ALT_LOG_DIR = "/tmp/streamdeck-sonos";
const ALT_LOG_PATH = join(ALT_LOG_DIR, "runtime.log");

async function logToFile(message) {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} ${message}\n`;

    try {
        await mkdir(LOG_DIR, { recursive: true });
        await appendFile(LOG_PATH, line);
    } catch (error) {
        streamDeck.logger.error(`File log failed: ${error.message}`);
    }

    try {
        await mkdir(ALT_LOG_DIR, { recursive: true });
        await appendFile(ALT_LOG_PATH, line);
    } catch (error) {
        streamDeck.logger.error(`Alt log failed: ${error.message}`);
    }
}

function normalizeTime(value) {
    if (!value || !/^\d?\d:\d\d:\d\d$/.test(value)) {
        return null;
    }

    return value.replace(/^0+:/, '');
}

function formatRemaining(elapsed, duration) {
    if (!elapsed || !duration) {
        return null;
    }

    const elapsedSec = elapsed.split(':').reduce((p, c) => p * 60 + Number(c), 0);
    const durationSec = duration.split(':').reduce((p, c) => p * 60 + Number(c), 0);
    if (!durationSec || durationSec < elapsedSec) {
        return null;
    }

    const remainingSec = durationSec - elapsedSec;
    return new Date(remainingSec * 1000).toISOString().substring(11, 19).replace(/^0+:/, '');
}

function buildPlayPauseTexts(settings, trackInfo, paused) {
    const titleParameters = settings?.titleParameters || DEFAULT_TITLE_PARAMS;
    if (!titleParameters.showTitle) {
        return null;
    }

    const artist = trackInfo.artist;
    const title = artist ? trackInfo.title : trackInfo.streamContent || trackInfo.title;
    const elapsed = normalizeTime(trackInfo.elapsed);
    const duration = normalizeTime(trackInfo.duration);
    const remaining = formatRemaining(trackInfo.elapsed, trackInfo.duration);

    const info = {
        artist,
        title,
        duration: duration || null,
        elapsed: elapsed || null,
        remaining: remaining || null
    };

    if (paused && settings?.paused) {
        return { bottom: settings.paused };
    }

    return {
        top: info[settings?.top],
        middle: info[settings?.middle],
        bottom: info[settings?.bottom]
    };
}

function buildTitleText(texts) {
    if (!texts) {
        return '';
    }

    return [texts.top, texts.middle, texts.bottom]
        .filter(Boolean)
        .join('\n');
}

async function fetchImageDataUrl(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch album art (${response.status})`);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
}

async function updatePlayPauseKey(action, settings, togglePlayback) {
    try {
        const { CurrentTransportState } = await sonos.getTransportInfo();
        const isPlaying = CurrentTransportState === 'PLAYING';

        if (togglePlayback) {
            if (isPlaying) {
                await sonos.pauseWithFallback();
            } else {
                await sonos.play();
            }
        }

        const newTransport = togglePlayback ? (isPlaying ? 'PAUSED_PLAYBACK' : 'PLAYING') : CurrentTransportState;
        const isNowPlaying = newTransport === 'PLAYING';
        const trackInfo = await sonos.getTrackInfo();
        const titleParameters = settings?.titleParameters || DEFAULT_TITLE_PARAMS;
        const texts = buildPlayPauseTexts(settings, trackInfo, !isNowPlaying);
        const titleText = buildTitleText(texts);

        if (settings?.showAlbumArt === '1' && trackInfo.albumArtURI) {
            const dataUrl = await fetchImageDataUrl(trackInfo.albumArtURI);
            await action.setImage(dataUrl, { target: 0 });
        } else {
            await action.setImage(undefined);
        }

        if (titleParameters.showTitle) {
            await action.setTitle(titleText, { target: 0 });
        } else {
            await action.setTitle(undefined);
        }

        await action.setState(isNowPlaying ? 1 : 0);
    } catch (error) {
        streamDeck.logger.error(`PlayPause render error: ${error.message}`);
        await logToFile(`PlayPause render error: ${error.stack || error.message}`);
        await action.setTitle(undefined);
        await action.setImage(undefined);
        throw error;
    }
}

async function updateFavoritesKey(action, settings) {
    if (!settings?.showAlbumArt || settings.showAlbumArt !== '1') {
        await action.setImage(undefined);
        return;
    }

    if (!settings.favorite) {
        await action.setImage(undefined);
        return;
    }

    try {
        const favorite = JSON.parse(settings.favorite);
        if (!favorite?.albumArtURI) {
            await action.setImage(undefined);
            return;
        }

        const dataUrl = await fetchImageDataUrl(favorite.albumArtURI);
        await action.setImage(dataUrl, { target: 0 });
    } catch (error) {
        streamDeck.logger.error(`Favorites render error: ${error.message}`);
        await logToFile(`Favorites render error: ${error.stack || error.message}`);
        await action.setImage(undefined);
    }
}

function startPlayPausePolling(action) {
    stopPlayPausePolling(action.context);
    const handle = setInterval(() => {
        const settings = playPauseSettings.get(action.context) || {};
        updatePlayPauseKey(action, settings, false).catch(() => {
        });
    }, PLAYPAUSE_REFRESH_MS);
    playPauseTimers.set(action.context, handle);
}

function stopPlayPausePolling(context) {
    const handle = playPauseTimers.get(context);
    if (handle) {
        clearInterval(handle);
        playPauseTimers.delete(context);
    }
}

// Register event handlers BEFORE connection
streamDeck.actions.onKeyDown(async (ev) => {
    const { action, payload } = ev;
    const actionId = action.manifestId;

    streamDeck.logger.info(`Button pressed: ${actionId}`);

    try {
        switch (actionId) {
            case "com.moonbeamalpha.streamdeck-sonos-v2.playpause":
                ensureConnected();
                const playPauseActionSettings = payload.settings || {};
                playPauseSettings.set(action.context, playPauseActionSettings);
                await updatePlayPauseKey(action, playPauseActionSettings, true);
                startPlayPausePolling(action);
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.previous":
                ensureConnected();
                streamDeck.logger.info('Previous button: Starting previousWithFallback');
                try {
                    await sonos.previousWithFallback();
                    streamDeck.logger.info('Previous button: Success');
                    await action.showOk();
                } catch (error) {
                    streamDeck.logger.error(`Previous button failed: ${error.message}`);
                    throw error;
                }
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.next":
                ensureConnected();
                await sonos.next();
                await action.showOk();
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.mute":
                ensureConnected();
                const { CurrentMute } = await sonos.getMute();
                const newMute = CurrentMute === '0' || CurrentMute === false;
                await sonos.setMute(newMute);
                await action.setState(newMute ? 1 : 0);
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.volumeup":
                ensureConnected();
                const incrementSettings = payload.settings;
                const increment = parseInt(incrementSettings.volume) || 10;
                const { CurrentVolume: currentVolumeUp } = await sonos.getVolume();
                const newVolumeUp = Math.min(100, parseInt(currentVolumeUp) + increment);
                await sonos.setVolume(newVolumeUp);
                await action.showOk();
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.volumedown":
                ensureConnected();
                const decrementSettings = payload.settings;
                const decrement = parseInt(decrementSettings.volume) || 10;
                const { CurrentVolume: currentVolumeDown } = await sonos.getVolume();
                const newVolumeDown = Math.max(0, parseInt(currentVolumeDown) - decrement);
                await sonos.setVolume(newVolumeDown);
                await action.showOk();
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.volume":
                ensureConnected();
                const volumeSettings = payload.settings;
                const volume = parseInt(volumeSettings.volume) || 50;
                await sonos.setVolume(Math.max(0, Math.min(100, volume)));
                await action.showOk();
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.repeat":
                ensureConnected();
                const { PlayMode: repeatPlayMode } = await sonos.getTransportSettings();

                let newRepeatMode = 'NORMAL';
                let newRepeatState = 0;

                if (repeatPlayMode === 'NORMAL' || repeatPlayMode === 'SHUFFLE_NOREPEAT') {
                    newRepeatMode = repeatPlayMode.includes('SHUFFLE') ? 'SHUFFLE' : 'REPEAT_ALL';
                    newRepeatState = 1;
                } else if (repeatPlayMode === 'REPEAT_ALL' || repeatPlayMode === 'SHUFFLE') {
                    newRepeatMode = repeatPlayMode.includes('SHUFFLE') ? 'SHUFFLE_REPEAT_ONE' : 'REPEAT_ONE';
                    newRepeatState = 2;
                } else {
                    newRepeatMode = repeatPlayMode.includes('SHUFFLE') ? 'SHUFFLE_NOREPEAT' : 'NORMAL';
                    newRepeatState = 0;
                }

                await sonos.setPlayModeForGroup(newRepeatMode);
                await action.setState(newRepeatState);
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.shuffle":
                ensureConnected();
                const { PlayMode: shufflePlayMode } = await sonos.getTransportSettings();

                let newShuffleMode = 'NORMAL';
                let newShuffleState = 0;

                if (!shufflePlayMode.includes('SHUFFLE')) {
                    if (shufflePlayMode === 'REPEAT_ALL') newShuffleMode = 'SHUFFLE';
                    else if (shufflePlayMode === 'REPEAT_ONE') newShuffleMode = 'SHUFFLE_REPEAT_ONE';
                    else newShuffleMode = 'SHUFFLE_NOREPEAT';
                    newShuffleState = 1;
                } else {
                    if (shufflePlayMode === 'SHUFFLE') newShuffleMode = 'REPEAT_ALL';
                    else if (shufflePlayMode === 'SHUFFLE_REPEAT_ONE') newShuffleMode = 'REPEAT_ONE';
                    else newShuffleMode = 'NORMAL';
                    newShuffleState = 0;
                }

                await sonos.setPlayModeForGroup(newShuffleMode);
                await action.setState(newShuffleState);
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.changesource":
                ensureConnected();
                const sourceSettings = payload.settings;
                const source = sourceSettings.source || 'queue';

                if (source === 'tv') {
                    await sonos.setLocalTransport('x-sonos-htastream', ':spdif');
                } else if (source === 'line_in') {
                    await sonos.setLocalTransport('x-rincon-stream');
                } else {
                    await sonos.setLocalTransport('x-rincon-queue', '#0');
                }

                if (sourceSettings.play === '1') {
                    await sonos.play();
                }

                await action.showOk();
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.playuri":
                ensureConnected();
                const uriSettings = payload.settings;
                const uri = uriSettings.uri;

                if (!uri) {
                    throw new Error('No URI specified');
                }

                const service = sonos.parseServiceURI(uri);
                if (!service) {
                    throw new Error(`Invalid media URI "${uri}"`);
                }

                await sonos.setServiceURI(service.uri, service.metadata);

                if (uriSettings.play === '1') {
                    await sonos.play();
                }

                await action.showOk();
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.playfavorites":
                ensureConnected();
                const favSettings = payload.settings || {};
                const favoriteStr = favSettings.favorite;

                streamDeck.logger.info(`Play Favorites - Settings: ${JSON.stringify(favSettings)}`);

                if (!favoriteStr) {
                    throw new Error('No favorite specified');
                }

                try {
                    const favorite = JSON.parse(favoriteStr);
                    streamDeck.logger.info(`Play Favorites - Parsed favorite: ${JSON.stringify({ title: favorite.title, uri: favorite.uri })}`);
                    streamDeck.logger.info(`Play Favorites - URI: ${favorite.uri}`);
                    streamDeck.logger.info(`Play Favorites - Metadata length: ${favorite.metadata?.length || 0}`);
                    await logToFile(`Play Favorites - URI: ${favorite.uri}`);
                    await logToFile(`Play Favorites - Metadata: ${favorite.metadata || '(empty)'}`);

                    await sonos.setServiceURI(favorite.uri, favorite.metadata || '');
                    streamDeck.logger.info('Play Favorites - setServiceURI completed');

                    if (favSettings.play === '1') {
                        await sonos.play();
                        streamDeck.logger.info('Play Favorites - play() completed');
                    }

                    await updateFavoritesKey(action, favSettings);
                    await action.showOk();
                    streamDeck.logger.info('Play Favorites - Success');
                } catch (favError) {
                    streamDeck.logger.error(`Play Favorites - Detailed error: ${favError.stack || favError.message}`);
                    await logToFile(`Play Favorites - Detailed error: ${favError.stack || favError.message}`);
                    throw favError;
                }
                break;

            default:
                streamDeck.logger.warn(`Unknown action: ${actionId}`);
        }
    } catch (error) {
        streamDeck.logger.error(`Action error (${actionId}): ${error.message}`);
        await logToFile(`Action error (${actionId}): ${error.stack || error.message}`);
        await action.showAlert();
    }
});

// Handle onWillAppear to set initial states
streamDeck.actions.onWillAppear(async (ev) => {
    const { action } = ev;
    const actionId = action.manifestId;

    try {
        switch (actionId) {
            case "com.moonbeamalpha.streamdeck-sonos-v2.playpause":
                ensureConnected();
                const playPauseActionSettings = ev.payload.settings || {};
                playPauseSettings.set(action.context, playPauseActionSettings);
                await updatePlayPauseKey(action, playPauseActionSettings, false);
                startPlayPausePolling(action);
                break;


            case "com.moonbeamalpha.streamdeck-sonos-v2.mute":
                ensureConnected();
                const { CurrentMute } = await sonos.getMute();
                const muteState = (CurrentMute === '1' || CurrentMute === true) ? 1 : 0;
                await action.setState(muteState);
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.repeat":
                ensureConnected();
                const { PlayMode: repeatMode } = await sonos.getTransportSettings();
                let repeatState = 0;
                if (repeatMode.includes('REPEAT_ONE')) repeatState = 2;
                else if (repeatMode.includes('REPEAT') || repeatMode === 'SHUFFLE') repeatState = 1;
                await action.setState(repeatState);
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.shuffle":
                ensureConnected();
                const { PlayMode: shuffleMode } = await sonos.getTransportSettings();
                const shuffleState = shuffleMode.includes('SHUFFLE') ? 1 : 0;
                await action.setState(shuffleState);
                break;

            case "com.moonbeamalpha.streamdeck-sonos-v2.playfavorites":
                ensureConnected();
                await updateFavoritesKey(action, ev.payload.settings || {});
                break;
        }
    } catch (error) {
        streamDeck.logger.error(`WillAppear error (${action.id}): ${error.message}`);
        await logToFile(`WillAppear error (${action.id}): ${error.stack || error.message}`);
    }
});

streamDeck.actions.onWillDisappear(async (ev) => {
    const { action } = ev;
    if (action.manifestId === "com.moonbeamalpha.streamdeck-sonos-v2.playpause") {
        stopPlayPausePolling(action.context);
        playPauseSettings.delete(action.context);
    }
});

// Connect to Stream Deck and request settings
streamDeck.connect().then(() => {
    streamDeck.logger.info('Sonos plugin connected to Stream Deck');
    streamDeck.settings.getGlobalSettings();
}).catch(error => {
    streamDeck.logger.error('Failed to connect to Stream Deck:', error);
});
