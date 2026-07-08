import { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Manage Payouts' };

const AdminPayoutsPage = dynamic(
  () => import('@/components/admin/AdminPayoutsPage').then((mod) => mod.AdminPayoutsPage),
  { ssr: false }
);

export default function AdminPayouts() {
  return <AdminPayoutsPage />;
}
