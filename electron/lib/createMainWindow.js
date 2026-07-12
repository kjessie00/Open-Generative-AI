'use strict';

/**
 * Create the desktop window while keeping Electron dependencies injectable.
 * The injection boundary lets security tests prove that the navigation policy
 * is installed on the exact webContents instance exposed by BrowserWindow.
 */
function createMainWindow({
    BrowserWindow,
    installNavigationPolicy,
    pathModule,
    dirname,
    platform = process.platform,
}) {
    const isMac = platform === 'darwin';
    const window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: pathModule.join(dirname, 'preload.js'),
        },
        ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
        backgroundColor: '#0d0d0d',
        show: false,
        title: 'Cinematic Pipeline Studio',
    });

    // Install the deny-by-default boundary before renderer content is loaded.
    installNavigationPolicy(window.webContents);

    const indexPath = pathModule.join(dirname, '../dist/index.html');
    window.loadFile(indexPath).catch((error) => {
        console.error('Failed to load index.html:', error);
        window.show();
    });

    window.webContents.on('did-fail-load', (event, code, description) => {
        console.error('did-fail-load:', code, description);
    });

    window.once('ready-to-show', () => window.show());
    return window;
}

module.exports = { createMainWindow };
