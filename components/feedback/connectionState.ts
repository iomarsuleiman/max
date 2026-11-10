export interface ConnectionMessage {
  title: string;
  body: string;
  action: string;
}

/** An OAuth provider can put arbitrary text in the callback. Only fixed copy is displayed. */
export function connectionMessage(reason: string | undefined): ConnectionMessage {
  switch (reason) {
    case "access_denied":
      return {
        title: "You stayed in control.",
        body: "Notion access was not granted. Connect again when you are ready, and choose the pages you want Max to read.",
        action: "Connect Notion again",
      };
    case "expired":
    case "invalid_state":
      return {
        title: "This connection link has expired.",
        body: "Return to Max and start a fresh connection. For your privacy, authorization links can only be used once.",
        action: "Start a new connection",
      };
    case "not_configured":
      return {
        title: "Notion is not set up here yet.",
        body: "This Max server needs its Notion integration configured before you can connect. You can still import a Notion export file from Settings, Data & export.",
        action: "Open Connections",
      };
    case "invalid_target":
      return {
        title: "Check the connection address.",
        body: "The assistant sent an unsupported resource target. Use Max's exact MCP server address once, then start a new connection in your assistant.",
        action: "Open connection help",
      };
    case "session_expired":
    case "unauthenticated":
      return {
        title: "Sign in to continue.",
        body: "Your Max session has ended. Sign in to your account, then start the connection again from Settings.",
        action: "Sign in to Max",
      };
    case "permission_denied":
      return {
        title: "This connection is not available.",
        body: "Sign in to the Max account that started this connection. Each account authorizes its own workspace access.",
        action: "Sign in to Max",
      };
    default:
      return {
        title: "This connection needs another try.",
        body: "Max could not finish connecting to Notion. Return to Connections and try again. Your existing Max pages are still available.",
        action: "Open Connections",
      };
  }
}
