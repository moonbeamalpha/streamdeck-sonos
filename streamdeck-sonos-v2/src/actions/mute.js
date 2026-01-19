define(class extends PollingAction {
    async onKeyDown({payload: {state}}) {
        try {
            return state === 0 ?
                this.sonos.setMute(1) :
                this.sonos.setMute(0);
        } catch (error) {
            console.error('Mute onKeyDown error:', error);
            this.streamDeck.logMessage(`Mute error: ${error.message || error}`);
            this.streamDeck.showAlert(this.context);
        }
    }

    async refresh() {
        try {
            const {CurrentMute: muted} = await this.sonos.getMute();
            return this.streamDeck.setState(muted === '1' ? 1 : 0, this.context);
        } catch (error) {
            console.error('Mute refresh error:', error);
            this.streamDeck.logMessage(`Mute refresh error: ${error.message || error}`);
            throw error;
        }
    }
});
