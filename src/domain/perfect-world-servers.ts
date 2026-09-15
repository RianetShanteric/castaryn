export const perfectWorldServers = [
  "Мицар",
  "Центавр",
  "Фенрир",
  "Капелла",
] as const;

export function isCurrentPerfectWorldServer(
  server: string,
): server is (typeof perfectWorldServers)[number] {
  return perfectWorldServers.some((current) => current === server);
}
