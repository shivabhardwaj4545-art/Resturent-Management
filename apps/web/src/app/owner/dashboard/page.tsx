'use client';

import dynamic from 'next/dynamic';

const OwnerDashboard = dynamic(
  () => import('@/components/owner/OwnerDashboard').then((mod) => mod.OwnerDashboard),
  { ssr: false }
);

export default function OwnerDashboardPage() {
  return <OwnerDashboard />;
}
