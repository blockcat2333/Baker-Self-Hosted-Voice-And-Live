export function syncGatewayChannelSubscription(
  previousChannelId: string | null,
  nextChannelId: string | null,
  switchChannel: (previousChannelId: string | null, nextChannelId: string | null) => void,
) {
  if (previousChannelId === nextChannelId) {
    return;
  }

  switchChannel(previousChannelId, nextChannelId);
}
