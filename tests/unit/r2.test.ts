import { describe, expect, it } from "vitest";
import { keyBelongsTo, newObjectKey, presign, r2ConfigFromEnv } from "@/lib/domain/r2";

describe("R2 presigned URLs (AWS Signature V4)", () => {
  it("matches AWS's published example for a presigned GET", async () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = await presign(
      { endpoint: "https://s3.amazonaws.com", bucket: "examplebucket", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" },
      "GET",
      "test.txt",
      { now: Date.UTC(2013, 4, 24), expires: 86400, virtualHost: true },
    );
    expect(url).toContain("https://examplebucket.s3.amazonaws.com/test.txt?");
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });

  it("signs the upload's type and size, reads R2 settings from the environment, and makes opaque keys", async () => {
    const cfg = r2ConfigFromEnv({ R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "max" })!;
    expect(cfg.endpoint).toBe("https://acc.r2.cloudflarestorage.com");
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "acc" })).toBeNull();
    const put = await presign(cfg, "PUT", "u/ab/abc.png", { now: Date.UTC(2026, 10, 20), expires: 600, headers: { "Content-Type": "image/png", "Content-Length": "1234" } });
    expect(put).toMatch(/^https:\/\/acc\.r2\.cloudflarestorage\.com\/max\/u\/ab\/abc\.png\?/);
    expect(decodeURIComponent(put)).toContain("X-Amz-SignedHeaders=content-length;content-type;host");
    const key = await newObjectKey("user_123", "image/jpeg");
    expect(key).toMatch(/^u\/[0-9a-f]{16}\/[0-9a-f]{32}\.jpg$/);
    expect(key).not.toContain("user_123");
    expect(await keyBelongsTo(key, "user_123")).toBe(true);
    expect(await keyBelongsTo(key, "user_456")).toBe(false);
  });

  it("won't register someone else's R2 file in your workspace", async () => {
    const { setup } = await import("./harness");
    const h = setup();
    const theirs = await newObjectKey("user_b", "image/png");
    await expect(h.as("user_a")("assets.register", { storageId: `r2:${theirs}`, pageId: null, name: "x.png", type: "image/png", size: 10 })).rejects.toThrow(/isn't yours/);
    const mine = await newObjectKey("user_a", "image/png");
    await expect(h.as("user_a")("assets.register", { storageId: `r2:${mine}`, pageId: null, name: "x.png", type: "image/png", size: 10 })).resolves.toBeTruthy();
  });
});
