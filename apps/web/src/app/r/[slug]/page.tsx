import type { Metadata } from 'next';
import { RestaurantMenuPage } from '@/components/customer/RestaurantMenuPage';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    table?: string;
    t?: string;
    token?: string;
    preview?: string;
    themeColor?: string;
    name?: string;
    description?: string;
    logo?: string;
    banner?: string;
  }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Menu — ${slug}`,
    description: `Browse the full menu at this restaurant and order online via QR code.`,
  };
}

export default async function MenuPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;

  let effectiveTable: string | undefined = undefined;
  let effectiveToken: string | undefined = undefined;

  if (resolvedSearchParams.t) {
    try {
      const decoded = Buffer.from(resolvedSearchParams.t, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      if (parts.length === 2 && parts[0] && parts[1]) {
        effectiveTable = parts[0];
        effectiveToken = parts[1];
      }
    } catch {
      // Invalid t token payload
    }
  } else if (resolvedSearchParams.table && resolvedSearchParams.token) {
    effectiveTable = resolvedSearchParams.table;
    effectiveToken = resolvedSearchParams.token;
  }

  return (
    <RestaurantMenuPage
      slug={slug}
      tableNumber={effectiveTable}
      searchParams={{
        ...resolvedSearchParams,
        table: effectiveTable,
        token: effectiveToken,
      }}
    />
  );
}
