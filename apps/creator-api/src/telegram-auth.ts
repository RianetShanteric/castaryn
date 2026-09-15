import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const TelegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1).max(128),
  last_name: z.string().max(128).optional(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(16).optional(),
});

export type TelegramAdmin = z.infer<typeof TelegramUserSchema>;

export class TelegramAuthError extends Error {}

export function verifyTelegramInitData(input: {
  initData: string;
  botToken: string;
  allowedUserId: number;
  now?: Date;
  maxAgeSeconds?: number;
}): TelegramAdmin {
  const params = new URLSearchParams(input.initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  const userJson = params.get("user");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new TelegramAuthError("Telegram signature is missing");
  }
  if (!Number.isSafeInteger(authDate) || !userJson) {
    throw new TelegramAuthError("Telegram session is incomplete");
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const maxAgeSeconds = input.maxAgeSeconds ?? 300;
  if (authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new TelegramAuthError("Telegram session has expired");
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(input.botToken)
    .digest();
  const expectedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();
  const actualHash = Buffer.from(receivedHash, "hex");

  if (
    actualHash.length !== expectedHash.length ||
    !timingSafeEqual(actualHash, expectedHash)
  ) {
    throw new TelegramAuthError("Telegram signature is invalid");
  }

  const user = TelegramUserSchema.parse(JSON.parse(userJson));
  if (user.id !== input.allowedUserId) {
    throw new TelegramAuthError("Telegram user is not allowed");
  }
  return user;
}
