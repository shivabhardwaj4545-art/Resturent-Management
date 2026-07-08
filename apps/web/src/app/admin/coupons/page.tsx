import { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Manage Coupons' };

const AdminCouponsPage = dynamic(
  () => import('@/components/admin/AdminCouponsPage').then((mod) => mod.AdminCouponsPage)
);

export default function AdminCoupons() {
  return <AdminCouponsPage />;
}
