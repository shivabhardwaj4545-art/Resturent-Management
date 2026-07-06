import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Dashboard' };

const OwnerDashboard = dynamic(
  () => import('@/components/owner/OwnerDashboard').then((mod) => mod.OwnerDashboard)
);

export default function OwnerDashboardPage() {
  return <OwnerDashboard />;
}
