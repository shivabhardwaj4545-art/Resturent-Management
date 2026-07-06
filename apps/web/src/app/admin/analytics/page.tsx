import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = { title: 'Analytics' };

const AdminAnalyticsPage = dynamic(
  () => import('@/components/admin/AdminAnalyticsPage').then((mod) => mod.AdminAnalyticsPage)
);

export default function AdminAnalytics() {
  return <AdminAnalyticsPage />;
}
