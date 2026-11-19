export function refreshEventStatus(store, eventId) {
  const counts = store.deliveryStatusCounts(eventId);
  const terminal = counts.succeeded + counts.failed;
  if (counts.pending > 0 || terminal === 0) return;
  store.setEventStatus(eventId, counts.succeeded > 0 ? 'delivered' : 'failed');
}
