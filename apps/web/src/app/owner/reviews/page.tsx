import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Reviews' };

const OwnerReviewsPage = dynamic(
  () => import('@/components/owner/OwnerReviewsPage').then((mod) => mod.OwnerReviewsPage)
);

export default function OwnerReviewsRouting() {
  return <OwnerReviewsPage />;
}
