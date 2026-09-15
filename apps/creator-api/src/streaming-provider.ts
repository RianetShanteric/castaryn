import { z } from "zod";

export const StreamingProviderIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_-]{1,31}$/);

export type StreamingProviderId = z.infer<
  typeof StreamingProviderIdSchema
>;

export interface StreamingChannelProvisioner {
  readonly provider: StreamingProviderId;
  provisionChannel(
    externalChannelId: string,
  ): Promise<"pending" | "ready">;
}
