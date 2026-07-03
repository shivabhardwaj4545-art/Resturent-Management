import type { Metadata } from 'next';
import { RestaurantMenuPage } from '@/components/customer/RestaurantMenuPage';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    table?: string;
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

  return (
    <RestaurantMenuPage
      slug={slug}
      tableNumber={resolvedSearchParams.table}
      searchParams={resolvedSearchParams}
    />
  );
}
