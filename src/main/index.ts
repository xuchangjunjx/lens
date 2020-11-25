// Main process

import "../common/system-ca";
import "../common/prometheus-providers";
import * as Mobx from "mobx";
import * as LensExtensions from "../extensions/core-api";
import { app, dialog } from "electron";
import { appName } from "../common/vars";
import path from "path";
import { LensProxy } from "./lens-proxy";
import { WindowManager } from "./window-manager";
import { ClusterManager } from "./cluster-manager";
import { AppUpdater } from "./app-updater";
import { shellSync } from "./shell-sync";
import { getFreePort } from "./port";
import { mangleProxyEnv } from "./proxy-env";
import { registerFileProtocol } from "../common/register-protocol";
import logger from "./logger";
import { clusterStore } from "../common/cluster-store";
import { userStore } from "../common/user-store";
import { workspaceStore } from "../common/workspace-store";
import { appEventBus } from "../common/event-bus";
import { extensionLoader } from "../extensions/extension-loader";
import { extensionsStore } from "../extensions/extensions-store";
import { InstalledExtension, extensionDiscovery } from "../extensions/extension-discovery";
import type { LensExtensionId } from "../extensions/lens-extension";
import { installDeveloperTools } from "./developer-tools";
import { filesystemProvisionerStore } from "./extension-filesystem";

const workingDir = path.join(app.getPath("appData"), appName);
let proxyPort: number;
let proxyServer: LensProxy;
let clusterManager: ClusterManager;
let windowManager: WindowManager;

app.setName(appName);
if (!process.env.CICD) {
  app.setPath("userData", workingDir);
}

mangleProxyEnv();
if (app.commandLine.getSwitchValue("proxy-server") !== "") {
  process.env.HTTPS_PROXY = app.commandLine.getSwitchValue("proxy-server");
}

app.on("ready", async () => {
  logger.info(`🚀 Starting Lens from "${workingDir}"`);
  await shellSync();

  const updater = new AppUpdater();
  updater.start();

  registerFileProtocol("static", __static);

  await installDeveloperTools();

  // preload
  await Promise.all([
    userStore.load(),
    clusterStore.load(),
    workspaceStore.load(),
    extensionsStore.load(),
    filesystemProvisionerStore.load(),
  ]);

  // find free port
  try {
    proxyPort = await getFreePort();
  } catch (error) {
    logger.error(error);
    dialog.showErrorBox("Lens Error", "Could not find a free port for the cluster proxy");
    app.exit();
  }

  // create cluster manager
  clusterManager = ClusterManager.getInstance<ClusterManager>(proxyPort);

  // run proxy
  try {
    proxyServer = LensProxy.create(proxyPort, clusterManager);
  } catch (error) {
    logger.error(`Could not start proxy (127.0.0:${proxyPort}): ${error.message}`);
    dialog.showErrorBox("Lens Error", `Could not start proxy (127.0.0:${proxyPort}): ${error.message || "unknown error"}`);
    app.exit();
  }

  extensionLoader.init();

  extensionDiscovery.init();
  windowManager = WindowManager.getInstance<WindowManager>(proxyPort);

  // call after windowManager to see splash earlier
  const extensions = await extensionDiscovery.load();

  // Subscribe to extensions that are copied or deleted to/from the extensions folder
  extensionDiscovery.events.on("add", (extension: InstalledExtension) => {
    extensionLoader.addExtension(extension);
  });
  extensionDiscovery.events.on("remove", (lensExtensionId: LensExtensionId) => {
    extensionLoader.removeExtension(lensExtensionId);
  });

  extensionLoader.initExtensions(extensions);

  setTimeout(() => {
    appEventBus.emit({ name: "service", action: "start" });
  }, 1000);
});

app.on("activate", (event, hasVisibleWindows) => {
  logger.info('APP:ACTIVATE', { hasVisibleWindows });
  if (!hasVisibleWindows) {
    windowManager.initMainWindow();
  }
});

// Quit app on Cmd+Q (MacOS)
app.on("will-quit", (event) => {
  logger.info('APP:QUIT');
  appEventBus.emit({name: "app", action: "close"});
  event.preventDefault(); // prevent app's default shutdown (e.g. required for telemetry, etc.)
  clusterManager?.stop(); // close cluster connections
  return; // skip exit to make tray work, to quit go to app's global menu or tray's menu
});

// Extensions-api runtime exports
export const LensExtensionsApi = {
  ...LensExtensions,
};

export {
  Mobx,
  LensExtensionsApi as LensExtensions,
};
