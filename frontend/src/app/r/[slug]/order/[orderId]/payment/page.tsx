import { OrderPaymentPage } from '@/components/customer/OrderPaymentPage';

interface PageProps {
  params: Promise<{ slug: string; orderId: string }>;
}

export default async function PaymentRoute({ params }: PageProps) {
  const { slug, orderId } = await params;
  return <OrderPaymentPage orderId={orderId} restaurantSlug={slug} />;
}
