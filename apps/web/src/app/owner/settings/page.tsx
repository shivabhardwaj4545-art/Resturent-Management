import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Restaurant Settings' };

const OwnerSettingsPage = dynamic(
  () => import('@/components/owner/OwnerSettingsPage').then((mod) => mod.OwnerSettingsPage),
  { ssr: false }
);

export default function OwnerSettings() {
  return <OwnerSettingsPage />;
}
