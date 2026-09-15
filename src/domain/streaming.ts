export type StreamingIntegrationKind =
  | "platform"
  | "broadcast"
  | "chat"
  | "remote-control";

export type CreatorFeature =
  | "chat_commands"
  | "moderators"
  | "overlay"
  | "remote_configuration"
  | "events";

export type StreamingIntegrationDefinition = {
  id: string;
  name: string;
  kind: StreamingIntegrationKind;
  creatorFeatures: readonly CreatorFeature[];
  availability: "mvp" | "roadmap";
};

export const streamingIntegrations = [
  {
    id: "twitch",
    name: "Twitch",
    kind: "platform",
    creatorFeatures: [
      "chat_commands",
      "moderators",
      "remote_configuration",
      "events",
    ],
    availability: "mvp",
  },
  {
    id: "obs",
    name: "OBS",
    kind: "broadcast",
    creatorFeatures: ["overlay", "remote_configuration"],
    availability: "mvp",
  },
] as const satisfies readonly StreamingIntegrationDefinition[];

export function getStreamingIntegration(id: string) {
  return streamingIntegrations.find((integration) => integration.id === id);
}
