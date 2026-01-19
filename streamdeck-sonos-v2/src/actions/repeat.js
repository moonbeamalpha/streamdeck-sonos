define(class extends PollingAction {
    async onKeyDown({payload: {state}}) {
        try {
            const {PlayMode: mode} = await this.sonos.getTransportSettings()
            const shuffle = mode.indexOf('SHUFFLE') === 0;
            if (state === 0)
                return this.sonos.setPlayMode(shuffle ? 'SHUFFLE' : 'REPEAT_ALL');
            else if (state === 1)
                return this.sonos.setPlayMode(shuffle ? 'SHUFFLE_REPEAT_ONE' : 'REPEAT_ONE');
            else if (state === 2)
                return this.sonos.setPlayMode(shuffle ? 'SHUFFLE_NOREPEAT' : 'NORMAL');
        } catch (error) {
            console.error('Repeat onKeyDown error:', error);
            this.streamDeck.logMessage(`Repeat error: ${error.message || error}`);
            this.streamDeck.showAlert(this.context);
        }
    }

    async refresh() {
        try {
            const {PlayMode: mode} = await this.sonos.getTransportSettings();
            if (mode === 'NORMAL' || mode === 'SHUFFLE_NOREPEAT')
                return this.streamDeck.setState(0, this.context);
            else if (mode === 'REPEAT_ALL' || mode === 'SHUFFLE')
                return this.streamDeck.setState(1, this.context);
            else if (mode === 'REPEAT_ONE' || mode === 'SHUFFLE_REPEAT_ONE')
                return this.streamDeck.setState(2, this.context);
        } catch (error) {
            console.error('Repeat refresh error:', error);
            this.streamDeck.logMessage(`Repeat refresh error: ${error.message || error}`);
            throw error;
        }
    }
});
