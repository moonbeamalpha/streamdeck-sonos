define(class extends PollingAction {
    timeRegex = /^\d?\d:\d\d:\d\d$/;
    defaultTitleParameters = {
        fontFamily: 'Arial',
        fontSize: 10,
        fontStyle: 'Bold',
        fontUnderline: false,
        showTitle: true,
        titleColor: '#ffffff'
    };

    async onKeyDown({payload: {state}}) {
        try {
            if (state === 0) {
                await this.sonos.play();
                return this.drawState(1);
            } else {
                await this.sonos.pause();
                return this.drawState(0);
            }
        } catch (error) {
            console.error('PlayPause onKeyDown error:', error);
            this.streamDeck.logMessage(`PlayPause error: ${error.message || error}`);
            this.streamDeck.showAlert(this.context);
        }
    }

    async onTitleParametersDidChange(event) {
        this.settings = event.payload.settings;
        this.settings.titleParameters = event.payload.titleParameters;
        this.streamDeck.setSettings(this.settings, event.context);
        return this.refresh();
    }

    async refresh() {
        try {
            const {CurrentTransportState: transportState} = await this.sonos.getTransportInfo();
            const state = transportState === 'PLAYING' ? 1 : 0;
            this.streamDeck.setState(state, this.context);
            await this.drawState(state);
        } catch (error) {
            console.error('PlayPause refresh error:', error);
            this.streamDeck.logMessage(`PlayPause refresh error: ${error.message || error}`);
            // Don't show alert during polling, just log
            throw error; // Re-throw so polling handler can catch it
        }
    }

    async drawState(state) {
        try {
            const titleParameters = this.settings.titleParameters || this.defaultTitleParameters;

            if (this.settings.showAlbumArt !== '1')
                return this.streamDeck.setImage(null, 0, null, this.context);

            let {
                RelTime: elapsed,
                TrackDuration: duration,
                TrackMetaData: metadata
            } = await this.sonos.getPositionInfo();
            const track = new DOMParser().parseFromString(metadata, 'text/xml');
            const albumArtURI = this.sonos.getAlbumArtURI(track);
            if(!albumArtURI)
                return this.streamDeck.setImage(null, 0, null, this.context);

            let texts;
            if(titleParameters.showTitle) {
                const artist = this.sonos.getElementText(track, 'dc:creator');
                const title = artist ?
                    this.sonos.getElementText(track, 'dc:title') :
                    this.sonos.getElementText(track, 'r:streamContent');

                let remaining;
                if (elapsed && this.timeRegex.test(elapsed) && duration && this.timeRegex.test(duration)) {
                    const elapsedSec = elapsed.split(':').reduce((p, c) => p * 60 + +c, 0);
                    const durationSec = duration.split(':').reduce((p, c) => p * 60 + +c, 0);
                    const remainingSec = durationSec - elapsedSec;
                    remaining = new Date(remainingSec * 1000).toISOString().substring(11, 19);

                    duration = duration.replace(/^0+:/, '');
                    elapsed = elapsed.replace(/^0+:/, '');
                    remaining = remaining.replace(/^0+:/, '');
                } else {
                    duration = elapsed = remaining = null;
                }

                const info = {artist, title, duration, elapsed, remaining};
                texts = state === 0 && this.settings.paused ?
                    {bottom: this.settings.paused} :
                    {top: info[this.settings.top], middle: info[this.settings.middle], bottom: info[this.settings.bottom]}
            }

            return this.streamDeck.setImageURL(albumArtURI, texts, titleParameters, this.context);
        } catch (error) {
            console.error('PlayPause drawState error:', error);
            this.streamDeck.logMessage(`PlayPause drawState error: ${error.message || error}`);
            // Fallback to default state icon on error
            return this.streamDeck.setImage(null, state, null, this.context);
        }
    }
})
