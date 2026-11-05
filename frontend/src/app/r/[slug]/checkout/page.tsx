import { CheckoutPage } from '@/components/customer/CheckoutPage';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ table?: string; t?: string; token?: string }>;
}

export default async function Checkout({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;

  let effectiveTable: string | undefined = undefined;
  let effectiveToken: string | undefined = undefined;

  if (resolvedSearchParams.t) {
    try {
      const decoded = Buffer.from(resolvedSearchParams.t, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      if (parts.length >= 2 && parts[0]) {
        effectiveTable = parts[0];
        effectiveToken = parts[1];
      } else if (parts.length === 1 && parts[0]) {
        effectiveTable = parts[0];
      }
    } catch {
      // Invalid t token payload
    }
  } else if (resolvedSearchParams.table && resolvedSearchParams.token) {
    effectiveTable = resolvedSearchParams.table;
    effectiveToken = resolvedSearchParams.token;
  } else if (resolvedSearchParams.table) {
    effectiveTable = resolvedSearchParams.table;
  }

  return <CheckoutPage restaurantSlug={slug} tableNumber={effectiveTable} tableToken={effectiveToken} />;
}

