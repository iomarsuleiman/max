import { describe, expect, it } from "vitest";
import { connectionMessage } from "@/components/feedback/connectionState";

describe("connection recovery copy", () => {
  it("does not reflect arbitrary OAuth provider text or secrets", () => {
    const secret = "<script>alert(1)</script>?code=private-code&token=private-token";
    const message = connectionMessage(secret);
    expect(JSON.stringify(message)).not.toContain(secret);
    expect(message).toEqual(connectionMessage(undefined));
  });
  it("explains expired state without claiming that consent succeeded", () => {
    expect(connectionMessage("invalid_state")).toEqual(connectionMessage("expired"));
    expect(connectionMessage("expired").body).toContain("only be used once");
  });
  it("provides a specific recovery for invalid resource targets", () => {
    expect(connectionMessage("invalid_target").body).toContain("exact MCP server address once");
    expect(connectionMessage("invalid_target").action).toBe("Open connection help");
  });
});
