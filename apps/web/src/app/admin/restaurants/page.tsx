import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Manage Restaurants' };

const AdminRestaurantsPage = dynamic(
  () => import('@/components/admin/AdminRestaurantsPage').then((mod) => mod.AdminRestaurantsPage)
);

export default function AdminRestaurants() {
  return <AdminRestaurantsPage />;
}
