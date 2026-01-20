# Sonos Plugin for Elgato Stream Deck
Plugin which allows to control `Sonos` speakers and get live feedback.
Forked from the original plugin from https://github.com/GenericMale/streamdeck-sonos

![](screenshot.png)

# Features
- Code written in JavaScript
- Cross-platform (macOS, Windows)
- Play / Pause with Live Feedback (Album Cover, Artist, Title, Time)
- Previous & Next Track
- Change Input Source (Line In, TV, Queue)
- Play URL from Spotify, TuneIn, Tidal, Deezer and Apple Music
- Play Sonos Favorites
- Change Repeat & Shuffle Mode
- Change Volume
- NEW - Speakers in the same group are automatically detected and controlled.

# Limitations
The plugin is written in JavaScript which makes it Cross-Platform compatible and can be trusted to not perform anything dangerous.  

However, this also comes with some limitations:
- Speaker Auto Discovery cannot be performed.  
The IP address of one of the speakers in a group to control has to be entered manually but the IP can be easily retrieved from the Sonos App. 
- Writing to Files not possible.
- Accessing the clipboard not possible.
- Can't listen to Push Notifications.  
The plugin has to poll for status changes.

# Installation
Download releases from  from the [Releases](https://github.com/moonbeamalpha/streamdeck-sonos/releases/) section.

If you double-click the `com.moonbeamalpha.streamdeck-sonos-v2.streamDeckPlugin` file on your machine, Stream Deck will install the plugin.

# Development
This fork was vibe-coded using Claude Sonnet 4.5 and ChatGPT 5.2 Codex.

To generate the installation package, see the 
[Elgato SDK 2.0.0 developer documentation](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started).

A simple [bash script](generateImages.sh) is provided to generate all the images.  
The script requires ImageMagick to be installed and uses the [Material Design Icons](https://github.com/marella/material-design-icons).
