// Minimal, hardened preload. The renderer is a standard web app talking to the
// local backend over HTTP/WS, so we expose only a tiny, read-only bridge with
// app metadata rather than any Node primitives.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('roko', {
  isDesktop: true,
  platform: process.platform,
});
