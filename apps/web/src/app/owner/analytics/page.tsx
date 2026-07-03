'use client';

import dynamic from 'next/dynamic';

const OwnerAnalyticsPage = dynamic(
  () => import('@/components/owner/OwnerAnalyticsPage').then((mod) => mod.OwnerAnalyticsPage),
  { ssr: false }
);

export default function OwnerAnalytics() {
  return <OwnerAnalyticsPage />;
}
