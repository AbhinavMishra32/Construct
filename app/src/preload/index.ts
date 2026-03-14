import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("construct", {
  getRuntimeInfo: () => ({
    name: "Construct",
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform
  })
});

