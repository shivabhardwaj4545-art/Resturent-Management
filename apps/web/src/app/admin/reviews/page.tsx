import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Reviews' };

const AdminReviewsPage = dynamic(
  () => import('@/components/admin/AdminReviewsPage').then((mod) => mod.AdminReviewsPage)
);

export default function AdminReviewsRouting() {
  return <AdminReviewsPage />;
}
