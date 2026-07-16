const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const { createMainWindow } = require('./lib/createMainWindow');
const { installNavigationPolicy } = require('./lib/navigationPolicy');
const { register: registerFilmPipeline } = require('./lib/filmPipelineProvider');
const {
    registerSchemePrivileges,
    createFinalRenderPreviewProtocol,
} = require('./lib/finalRenderPreviewProtocol');

registerSchemePrivileges(protocol);
const finalRenderPreviewService = createFinalRenderPreviewProtocol();

// Ubuntu 24.04+ sets kernel.apparmor_restrict_unprivileged_userns=1 which
// blocks Chromium's user namespace sandbox. The .deb package ships an AppArmor
// profile that grants the permission cleanly. When running the AppImage on an
// affected system, run once: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
// or pass --no-sandbox on the command line.
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('disable-dev-shm-usage');
}

let mainWindow;

function createWindow() {
    mainWindow = createMainWindow({
        BrowserWindow,
        installNavigationPolicy,
        pathModule: path,
        dirname: __dirname,
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    finalRenderPreviewService.register(protocol);
    registerFilmPipeline(undefined, { finalRenderPreviewService });
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('before-quit', () => {
    finalRenderPreviewService.dispose();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
