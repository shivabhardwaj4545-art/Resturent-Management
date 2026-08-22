'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { toast } from 'sonner';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthStore();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    setMounted(true);
    if (mounted) {
      if (!isAuthenticated || !user) {
        router.push('/login');
      } else if (user.role !== 'SUPER_ADMIN') {
        router.push('/');
      }
    }
  }, [mounted, user, isAuthenticated, router]);

  // Socket.io connection for Super Admin real-time updates
  useEffect(() => {
    if (!user || user.role !== 'SUPER_ADMIN') return;

    const wsUrl = process.env.NEXT_PUBLIC_SOCKET_URL ?? process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') ?? 'http://localhost:4000';
    const socket: Socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.emit('join:user', user.id);
    socket.emit('join:admin');

    socket.on('admin:new_restaurant', (data: any) => {
      toast.info(`🏬 New Restaurant Registered: ${data.name || 'New Store'}`, { duration: 6000 });
      queryClient.invalidateQueries({ queryKey: ['admin-restaurants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
    });

    socket.on('admin:new_subscription', (data: any) => {
      toast.success(`💳 New Subscription Activated: ${data.planName || 'Plan'}`, { duration: 6000 });
      queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
    });

    socket.on('notification:new', (notif: any) => {
      toast.info(notif.title || '📢 System Alert', {
        description: notif.message,
        duration: 8000,
      });
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
      queryClient.invalidateQueries({ queryKey: ['chat-contacts'] });
    });

    socket.on('order:new', () => {
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
    });

    return () => {
      socket.disconnect();
    };
  }, [user, queryClient]);

  if (!mounted || !user || user.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
