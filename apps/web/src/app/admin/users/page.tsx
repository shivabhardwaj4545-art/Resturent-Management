import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Manage Users' };

const AdminUsersPage = dynamic(
  () => import('@/components/admin/AdminUsersPage').then((mod) => mod.AdminUsersPage),
  { ssr: false }
);

export default function AdminUsers() {
  return <AdminUsersPage />;
}
