import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Platform Settings' };

const AdminSettingsPage = dynamic(
  () => import('@/components/admin/AdminSettingsPage').then((mod) => mod.AdminSettingsPage)
);

export default function AdminSettings() {
  return <AdminSettingsPage />;
}
