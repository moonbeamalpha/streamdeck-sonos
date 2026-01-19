define(class extends SonosAction {
    async onKeyDown() {
        try {
            return this.sonos.next();
        } catch (error) {
            console.error('Next onKeyDown error:', error);
            this.streamDeck.logMessage(`Next error: ${error.message || error}`);
            this.streamDeck.showAlert(this.context);
        }
    }
});
