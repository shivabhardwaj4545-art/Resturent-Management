'use client';

import dynamic from 'next/dynamic';

const AdminAnalyticsPage = dynamic(
  () => import('@/components/admin/AdminAnalyticsPage').then((mod) => mod.AdminAnalyticsPage),
  { ssr: false }
);

export default function AdminAnalytics() {
  return <AdminAnalyticsPage />;
}
