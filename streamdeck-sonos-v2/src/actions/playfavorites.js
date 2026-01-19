define(class extends SonosAction {
    constructor(streamDeck, action, context) {
        super(streamDeck, action, context);
        this.streamDeck.getSettings(this.context);
    }

    async onKeyDown({payload: {settings}}) {
        try {
            const favorite = JSON.parse(settings.favorite);
            if (favorite) {
                await this.sonos.setServiceURI(favorite.uri, favorite.metadata);
                if (settings.play === '1')
                    return this.sonos.play();
            }
        } catch (error) {
            console.error('PlayFavorites onKeyDown error:', error);
            this.streamDeck.logMessage(`PlayFavorites error: ${error.message || error}`);
            this.streamDeck.showAlert(this.context);
        }
    }

    async onDidReceiveSettings({payload: {settings}}) {
        try {
            const favorite = JSON.parse(settings.favorite);
            if(favorite && settings.showAlbumArt === '1') {
                return this.streamDeck.setImageURL(favorite.albumArtURI, null, null, this.context);
            } else {
                return this.streamDeck.setImage(null, 0, null, this.context);
            }
        } catch (error) {
            console.error('PlayFavorites onDidReceiveSettings error:', error);
            this.streamDeck.logMessage(`PlayFavorites settings error: ${error.message || error}`);
            // Fallback to default image on error
            return this.streamDeck.setImage(null, 0, null, this.context);
        }
    }
});
