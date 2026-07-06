import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Dashboard' };

const AdminDashboard = dynamic(
  () => import('@/components/admin/AdminDashboard').then((mod) => mod.AdminDashboard),
  { ssr: false }
);

export default function AdminDashboardPage() {
  return <AdminDashboard />;
}
