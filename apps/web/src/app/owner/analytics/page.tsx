import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Analytics' };

const OwnerAnalyticsPage = dynamic(
  () => import('@/components/owner/OwnerAnalyticsPage').then((mod) => mod.OwnerAnalyticsPage)
);

export default function OwnerAnalytics() {
  return <OwnerAnalyticsPage />;
}
