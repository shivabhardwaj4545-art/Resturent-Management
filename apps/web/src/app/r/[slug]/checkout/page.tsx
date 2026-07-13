import { CheckoutPage } from '@/components/customer/CheckoutPage';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ table?: string; token?: string }>;
}

export default async function Checkout({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { table, token } = await searchParams;
  return <CheckoutPage restaurantSlug={slug} tableNumber={table} tableToken={token} />;
}
