export const saveOrderToRecent = (orderId: string, restaurantSlug: string) => {
  if (typeof window === 'undefined') return;
  try {
    const orders = localStorage.getItem('qr_restaurant_recent_orders');
    let parsed = [];
    if (orders) {
      parsed = JSON.parse(orders);
      if (!Array.isArray(parsed)) parsed = [];
    }
    parsed = parsed.filter((o: any) => o.orderId !== orderId);
    parsed.unshift({
      orderId,
      restaurantSlug,
      createdAt: Date.now(),
    });
    parsed = parsed.slice(0, 10);
    localStorage.setItem('qr_restaurant_recent_orders', JSON.stringify(parsed));
  } catch (e) {
    console.error('Failed to save order to recent orders list', e);
  }
};

