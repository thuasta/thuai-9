export const DEFAULT_LOCALHOST_PORT = "14514";
export const REMOTE_SERVER_URL = "ws://59.66.135.18:14514";
const currentLocation = globalThis.location || { host: "localhost", pathname: "/", port: "" };
export const NGINX_PROXY_URL = `ws://${currentLocation.host}/ws/game`;
export const DEFAULT_LOCALHOST_URL = `ws://localhost:${DEFAULT_LOCALHOST_PORT}`;
export const DEFAULT_SERVER_URL = isLikelyNginxHosted() ? NGINX_PROXY_URL : DEFAULT_LOCALHOST_URL;

function isLikelyNginxHosted() {
  return currentLocation.pathname.startsWith("/spectator/") && currentLocation.port !== "5173";
}

export function normalizeLocalhostPort(rawValue) {
  const value = String(rawValue || "").trim();
  if (!/^\d+$/.test(value)) {
    return DEFAULT_LOCALHOST_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return DEFAULT_LOCALHOST_PORT;
  }

  return String(port);
}

export function parseServerChoice(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return { mode: "localhost", localhostPort: DEFAULT_LOCALHOST_PORT };
  }

  if (value === REMOTE_SERVER_URL || value === "59.66.135.18:14514") {
    return { mode: "remote", localhostPort: DEFAULT_LOCALHOST_PORT };
  }

  if (value === "nginx" || value === NGINX_PROXY_URL || value.endsWith("/ws/game")) {
    return { mode: "nginx", localhostPort: DEFAULT_LOCALHOST_PORT };
  }

  const localhostMatch = value.match(/^(?:ws:\/\/)?localhost:(\d+)$/i);
  if (localhostMatch) {
    return {
      mode: "localhost",
      localhostPort: normalizeLocalhostPort(localhostMatch[1]),
    };
  }

  if (/^\d+$/.test(value)) {
    return {
      mode: "localhost",
      localhostPort: normalizeLocalhostPort(value),
    };
  }

  return { mode: "localhost", localhostPort: DEFAULT_LOCALHOST_PORT };
}

export function buildServerUrl(mode, localhostPort) {
  if (mode === "remote") {
    return REMOTE_SERVER_URL;
  }

  if (mode === "nginx") {
    return NGINX_PROXY_URL;
  }

  return `ws://localhost:${normalizeLocalhostPort(localhostPort)}`;
}

export function normalizeServerUrl(rawValue) {
  const choice = parseServerChoice(rawValue);
  return buildServerUrl(choice.mode, choice.localhostPort);
}

export function openWebSocket(serverUrl, WebSocketCtor = WebSocket) {
  return new WebSocketCtor(normalizeServerUrl(serverUrl));
}
