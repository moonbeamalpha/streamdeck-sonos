define(class extends PollingAction {
    async onKeyDown({payload: {state}}) {
        try {
            const {PlayMode: mode} = await this.sonos.getTransportSettings();
            if (mode === 'NORMAL' || mode === 'SHUFFLE_NOREPEAT')
                return this.sonos.setPlayMode(state === 0 ? 'SHUFFLE_NOREPEAT' : 'NORMAL');
            else if (mode === 'REPEAT_ALL' || mode === 'SHUFFLE')
                return this.sonos.setPlayMode(state === 0 ? 'SHUFFLE' : 'REPEAT_ALL');
            else if (mode === 'REPEAT_ONE' || mode === 'SHUFFLE_REPEAT_ONE')
                return this.sonos.setPlayMode(state === 0 ? 'SHUFFLE_REPEAT_ONE' : 'REPEAT_ONE');
        } catch (error) {
            console.error('Shuffle onKeyDown error:', error);
            this.streamDeck.logMessage(`Shuffle error: ${error.message || error}`);
            this.streamDeck.showAlert(this.context);
        }
    }

    async refresh() {
        try {
            const {PlayMode: mode} = await this.sonos.getTransportSettings();
            return this.streamDeck.setState(mode.indexOf('SHUFFLE') === 0 ? 1 : 0, this.context);
        } catch (error) {
            console.error('Shuffle refresh error:', error);
            this.streamDeck.logMessage(`Shuffle refresh error: ${error.message || error}`);
            throw error;
        }
    }
});
