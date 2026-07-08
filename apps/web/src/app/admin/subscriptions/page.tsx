import { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Manage Subscriptions' };

const AdminSubscriptionsPage = dynamic(
  () => import('@/components/admin/AdminSubscriptionsPage').then((mod) => mod.AdminSubscriptionsPage)
);

export default function AdminSubscriptions() {
  return <AdminSubscriptionsPage />;
}
