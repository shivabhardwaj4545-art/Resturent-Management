import type { Metadata } from 'next';
import { RestaurantMenuPage } from '@/components/customer/RestaurantMenuPage';
import { resolveTableToken } from '@qr-restaurant/shared';

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
  let isTableVerified = false;

  // 1. Verify cryptographic table token (?t=...)
  if (resolvedSearchParams.t) {
    const tokenResult = resolveTableToken(resolvedSearchParams.t, slug);
    if (tokenResult.valid && tokenResult.tableNumber) {
      effectiveTable = tokenResult.tableNumber;
      effectiveToken = resolvedSearchParams.t;
      isTableVerified = true;
    }
  } else if (resolvedSearchParams.preview === 'true') {
    // Owner preview in dashboard
    effectiveTable = resolvedSearchParams.table;
    isTableVerified = true;
  }

  return (
    <RestaurantMenuPage
      slug={slug}
      tableNumber={effectiveTable}
      tableToken={effectiveToken}
      isTableVerified={isTableVerified}
      searchParams={{
        ...resolvedSearchParams,
        table: effectiveTable,
        token: effectiveToken,
      }}
    />
  );
}
