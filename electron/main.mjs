import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.WSR_PORT ?? process.env.WSR_API_PORT ?? 3002);

let localServer;
let mainWindow;

async function createMainWindow() {
  process.env.WSR_PORT = String(port);
  process.env.WSR_DATA_DIR = app.getPath("userData");
  process.env.WSR_DIST_DIR = path.join(appRoot, "dist");

  const { startServer } = await import("../server/index.mjs");
  localServer = await startServer({ host, port });

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 660,
    title: "나무위키 스피드런",
    autoHideMenuBar: true,
    backgroundColor: "#f5f5f5",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  const appUrl = `http://${host}:${port}`;

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(targetUrl).catch(() => {});
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(appUrl)) {
      return { action: "allow" };
    }

    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const isBlockedNavigation =
      (input.alt && (key === "left" || key === "right")) ||
      (input.control && (key === "l" || key === "r")) ||
      key === "browserback" ||
      key === "browserforward";

    if (isBlockedNavigation) {
      event.preventDefault();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(appUrl);
}

async function closeLocalServer() {
  if (!localServer) {
    return;
  }

  await new Promise((resolve) => localServer.close(resolve));
  localServer = null;
}

app.whenReady().then(createMainWindow).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  closeLocalServer().finally(() => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
});

app.on("before-quit", () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error) => {
      console.error(error);
      app.quit();
    });
  }
});
