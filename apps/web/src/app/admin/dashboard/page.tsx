'use client';

import dynamic from 'next/dynamic';

const AdminDashboard = dynamic(
  () => import('@/components/admin/AdminDashboard').then((mod) => mod.AdminDashboard),
  { ssr: false }
);

export default function AdminDashboardPage() {
  return <AdminDashboard />;
}
