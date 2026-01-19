define(class extends SonosAction {
    async onKeyDown({payload: {settings}}) {
        try {
            const service = MusicService.parse(settings.uri);
            if (!service)
                throw new Error(`Invalid media URI "${settings.uri}"`);

            await this.sonos.setServiceURI(service.uri, service.metadata);

            if (settings.play === '1')
                return this.sonos.play();
        } catch (error) {
            console.error('PlayURI onKeyDown error:', error);
            this.streamDeck.logMessage(`PlayURI error: ${error.message || error}`);
            this.streamDeck.showAlert(this.context);
        }
    }
});
