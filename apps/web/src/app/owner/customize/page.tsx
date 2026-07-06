import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Customize Restaurant' };

const OwnerCustomizePage = dynamic(
  () => import('@/components/owner/OwnerCustomizePage').then((mod) => mod.OwnerCustomizePage)
);

export default function OwnerCustomize() {
  return <OwnerCustomizePage />;
}
