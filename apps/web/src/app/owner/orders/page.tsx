import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Orders' };

const OwnerOrdersPage = dynamic(
  () => import('@/components/owner/OwnerOrdersPage').then((mod) => mod.OwnerOrdersPage)
);

export default function OwnerOrders() {
  return <OwnerOrdersPage />;
}
