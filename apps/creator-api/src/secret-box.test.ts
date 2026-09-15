import { describe, expect, it } from "vitest";
import { SecretBox } from "./secret-box.js";

describe("SecretBox", () => {
  it("encrypts with a random nonce and authenticates ciphertext", () => {
    const box = new SecretBox(Buffer.alloc(32, 7));
    const first = box.encrypt("oauth-token");
    const second = box.encrypt("oauth-token");

    expect(first).not.toBe(second);
    expect(box.decrypt(first)).toBe("oauth-token");

    const parts = first.split(".");
    const ciphertext = Buffer.from(parts[3]!, "base64url");
    ciphertext[0] = ciphertext[0]! ^ 1;
    parts[3] = ciphertext.toString("base64url");

    expect(() => box.decrypt(parts.join("."))).toThrow();
  });
});
