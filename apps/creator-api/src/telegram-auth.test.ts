import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TelegramAuthError,
  verifyTelegramInitData,
} from "./telegram-auth.js";

const botToken = "123456789:abcdefghijklmnopqrstuvwxyzABCDEFG";
const now = new Date("2026-07-28T12:00:00.000Z");

function signedInitData(userId: number, authDate = now) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(authDate.getTime() / 1000)),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: userId, first_name: "Owner" }),
  });
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  params.set(
    "hash",
    createHmac("sha256", secret).update(checkString).digest("hex"),
  );
  return params.toString();
}

describe("Telegram Mini App authentication", () => {
  it("accepts fresh signed data for the allowed numeric user id", () => {
    expect(
      verifyTelegramInitData({
        initData: signedInitData(424242),
        botToken,
        allowedUserId: 424242,
        now,
      }),
    ).toMatchObject({ id: 424242, first_name: "Owner" });
  });

  it("rejects a different Telegram user even with a valid signature", () => {
    expect(() =>
      verifyTelegramInitData({
        initData: signedInitData(111111),
        botToken,
        allowedUserId: 424242,
        now,
      }),
    ).toThrow(TelegramAuthError);
  });

  it("rejects expired and modified sessions", () => {
    const expired = new Date(now.getTime() - 10 * 60_000);
    expect(() =>
      verifyTelegramInitData({
        initData: signedInitData(424242, expired),
        botToken,
        allowedUserId: 424242,
        now,
      }),
    ).toThrow(/expired/i);
    expect(() =>
      verifyTelegramInitData({
        initData: signedInitData(424242).replace("Owner", "Intruder"),
        botToken,
        allowedUserId: 424242,
        now,
      }),
    ).toThrow();
  });
});
