'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

function hexToHsl(hex: string): { primary: string; foreground: string } {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  let r = parseInt(hex.substring(0, 2), 16) / 255;
  let g = parseInt(hex.substring(2, 4), 16) / 255;
  let b = parseInt(hex.substring(4, 6), 16) / 255;

  let max = Math.max(r, g, b);
  let min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;

  if (max !== min) {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);

  const primary = `${h} ${s}% ${l}%`;
  const foreground = l > 70 ? '217 30% 11.8%' : '0 0% 100%';

  return { primary, foreground };
}

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthStore();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (mounted) {
      if (!isAuthenticated || !user) {
        router.push('/login');
      } else if (user.role !== 'RESTAURANT_OWNER') {
        router.push('/');
      }
    }
  }, [mounted, user, isAuthenticated, router]);

  const { data: restaurantData, isLoading: isRestLoading } = useQuery({
    queryKey: ['owner-restaurant-layout'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurant');
      return res.data.data.restaurant as { themeColor: string | null };
    },
    enabled: !!user && user.role === 'RESTAURANT_OWNER',
  });

  if (!mounted || !user || user.role !== 'RESTAURANT_OWNER') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  const themeColor = restaurantData?.themeColor ?? '#E85D04';
  const { primary: primaryHsl, foreground: foregroundHsl } = hexToHsl(themeColor);

  return (
    <div
      style={{
        '--primary': primaryHsl,
        '--primary-foreground': foregroundHsl,
        '--ring': primaryHsl,
      } as React.CSSProperties}
      className="min-h-screen"
    >
      {children}
    </div>
  );
}
