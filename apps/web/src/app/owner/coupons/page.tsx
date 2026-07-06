import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Coupon Management' };

const OwnerCouponsPage = dynamic(
  () => import('@/components/owner/OwnerCouponsPage').then((mod) => mod.OwnerCouponsPage),
  { ssr: false }
);

export default function OwnerCoupons() {
  return <OwnerCouponsPage />;
}
