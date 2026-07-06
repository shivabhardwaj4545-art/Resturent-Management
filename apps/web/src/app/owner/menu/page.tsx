import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Menu Management' };

const OwnerMenuPage = dynamic(
  () => import('@/components/owner/OwnerMenuPage').then((mod) => mod.OwnerMenuPage)
);

export default function OwnerMenu() {
  return <OwnerMenuPage />;
}
