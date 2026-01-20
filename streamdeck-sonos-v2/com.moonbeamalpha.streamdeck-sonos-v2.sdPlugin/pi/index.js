/**
 * This is the first function StreamDeck Software calls, when
 * establishing the connection to the plugin or the Property Inspector
 * @param {string} port - The socket's port to communicate with StreamDeck software.
 * @param {string} pluginUUID - A unique identifier, which StreamDeck uses to communicate with the plugin
 * @param {string} registerEvent - Identifies, if the event is meant for the property inspector or the plugin.
 * @param {string} info - Information about the host (StreamDeck) application
 * @param {string} actionInfo - Context is an internal identifier used to communicate to the host application.
 */
function connectElgatoStreamDeckSocket(port, pluginUUID, registerEvent, info, actionInfo) {
    const globalSettingsForm = document.getElementById('global-settings');
    const settingsForm = document.getElementById('settings');

    // Parse actionInfo if it's a string
    const parsedActionInfo = typeof actionInfo === 'string' ? JSON.parse(actionInfo) : actionInfo;
    const parsedInfo = typeof info === 'string' ? JSON.parse(info) : info;

    // Create WebSocket connection to Stream Deck
    const websocket = new WebSocket(`ws://127.0.0.1:${port}`);
    let currentActionSettings = {};
    let currentGlobalSettings = {};

    websocket.onopen = () => {
        // Register Property Inspector
        const registerPayload = {
            event: registerEvent,
            uuid: pluginUUID
        };
        websocket.send(JSON.stringify(registerPayload));

        // Request global settings
        websocket.send(JSON.stringify({
            event: 'getGlobalSettings',
            context: pluginUUID
        }));

        // Request action settings
        websocket.send(JSON.stringify({
            event: 'getSettings',
            context: parsedActionInfo.context
        }));
    };

    websocket.onmessage = (evt) => {
        const jsonObj = JSON.parse(evt.data);

        if (jsonObj.event === 'didReceiveGlobalSettings') {
            currentGlobalSettings = jsonObj.payload.settings || {};
            handleGlobalSettings(currentGlobalSettings);
        } else if (jsonObj.event === 'didReceiveSettings') {
            currentActionSettings = jsonObj.payload.settings || {};
            handleActionSettings(currentActionSettings);
        }
    };

    const handleGlobalSettings = (globalSettings) => {
        // Populate form with persisted global data
        FormUtils.setFormValue(globalSettings, globalSettingsForm);

        // Load favorites if this is the playfavorites action
        const action = parsedActionInfo.action.split('.').pop();
        if (action === 'playfavorites' && globalSettings.host) {
            loadFavorites(globalSettings.host, parseInt(globalSettings.port) || 1400, currentActionSettings.favorite);
        }
    };

    const handleActionSettings = (settings) => {
        // Populate form with persisted action settings
        FormUtils.setFormValue(settings, settingsForm);
    };

    const loadFavorites = async (host, port, selectedFavorite) => {
        try {
            // Simple HTTP request to get favorites from Sonos
            const response = await fetch(`http://${host}:${port}/MediaServer/ContentDirectory/Control`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset="utf-8"',
                    'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'
                },
                body: `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>FV:2</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>0</StartingIndex>
      <RequestedCount>100</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`
            });

            const text = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, 'text/xml');
            const result = xmlDoc.getElementsByTagName('Result')[0]?.textContent;

            if (result) {
                const resultDoc = parser.parseFromString(result, 'text/xml');
                const items = resultDoc.getElementsByTagName('item');
                const select = document.getElementById('favorites');

                // Clear existing options except the first one
                while (select.options.length > 1) {
                    select.remove(1);
                }

                const selected = selectedFavorite ? JSON.parse(selectedFavorite) : null;

                Array.from(items).forEach((item) => {
                    const title = item.getElementsByTagName('dc:title')[0]?.textContent || 'Unknown';
                    const uri = item.getElementsByTagName('res')[0]?.textContent || item.getAttribute('id');
                    const metadata = new XMLSerializer().serializeToString(item);

                    const option = document.createElement('option');
                    const itemData = { title, uri, metadata };
                    option.value = JSON.stringify(itemData);
                    option.selected = selected && selected.uri === uri;
                    option.innerHTML = title;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Failed to load favorites:', error);
        }
    };

    // Initialize on load
    FormUtils.loadLocalization(parsedInfo.application?.language ?? null, '../');
    FormUtils.addDynamicStyles(parsedInfo.colors);

    // Use last part of uuid to check which inputs to show
    const action = parsedActionInfo.action.split('.').pop();

    // Show the items for the action
    [...settingsForm.querySelectorAll('.sdpi-item')]
        .filter((e) => e.dataset.actions && e.dataset.actions.split(',').includes(action))
        .forEach((e) => e.classList.add('active'));

    // Disable controls which aren't visible, so they don't get included in the FormData
    settingsForm.querySelectorAll('.sdpi-item input,select,textarea')
        .forEach((e) => e.disabled = e.closest('.sdpi-item.active') === null);

    // Watch for changes to global settings and store them
    globalSettingsForm.addEventListener(
        'input',
        FormUtils.debounce(150, () => {
            const value = FormUtils.getFormValue(globalSettingsForm);
            websocket.send(JSON.stringify({
                event: 'setGlobalSettings',
                context: pluginUUID,
                payload: value
            }));
        })
    );

    // Watch for changes to action settings and store them
    settingsForm.addEventListener(
        'input',
        FormUtils.debounce(150, () => {
            const value = FormUtils.getFormValue(settingsForm);
            websocket.send(JSON.stringify({
                event: 'setSettings',
                context: parsedActionInfo.context,
                payload: value
            }));
        })
    );
}
