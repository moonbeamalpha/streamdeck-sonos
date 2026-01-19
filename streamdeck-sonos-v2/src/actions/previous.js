define(class extends SonosAction {
    async onKeyDown() {
        try {
            return this.sonos.previous();
        } catch (error) {
            console.error('Previous onKeyDown error:', error);
            this.streamDeck.logMessage(`Previous error: ${error.message || error}`);
            this.streamDeck.showAlert(this.context);
        }
    }
});
