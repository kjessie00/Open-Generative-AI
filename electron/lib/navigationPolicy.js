'use strict';

/**
 * The pipeline studio has no product requirement to open external URLs.
 * Keep both popups and renderer-initiated navigation deny-by-default.
 */
function installNavigationPolicy(webContents) {
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    webContents.on('will-navigate', (event) => event.preventDefault());
}

module.exports = { installNavigationPolicy };
