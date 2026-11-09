/**
 * Determines whether a given order item is an add-on item.
 * Supports:
 * 1. Direct `isAddon: true` flag from database.
 * 2. Fallback heuristic: If the order has `lastAddOnAt` and the item was created > 5s after the initial order creation.
 */
export function isItemAddon(
  item: { isAddon?: boolean; createdAt?: string | Date },
  order?: { createdAt?: string | Date; lastAddOnAt?: string | Date | null }
): boolean {
  if (item.isAddon === true) return true;
  if (!order || !order.lastAddOnAt || !item.createdAt || !order.createdAt) return false;
  const itemTime = new Date(item.createdAt).getTime();
  const orderTime = new Date(order.createdAt).getTime();
  if (isNaN(itemTime) || isNaN(orderTime)) return false;
  // If item was created at least 5 seconds after the original order, it was added in an add-on round
  return itemTime - orderTime > 5000;
}
