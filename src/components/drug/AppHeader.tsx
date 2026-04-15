'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Pill, Building2, Home, Layers } from 'lucide-react';

/** 导航菜单项配置 */
const navItems = [
  {
    label: '首页',
    href: '/',
    icon: Home,
  },
  {
    label: '广州药品采购平台',
    href: '/gz',
    icon: Pill,
  },
  {
    label: '广东省医保局',
    href: '/pubonln',
    icon: Building2,
  },
  {
    label: '药品汇总表',
    href: '/merged',
    icon: Layers,
  },
];

/**
 * 全局导航头组件
 * 提供系统标题和模块路由切换菜单
 */
export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto max-w-7xl flex h-16 items-center px-4">
        {/* 系统标识 */}
        <Link href="/" className="flex items-center gap-2 mr-8">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Pill className="h-4 w-4" />
          </div>
          <span className="font-bold text-lg hidden sm:inline-block">
            药品信息管理系统
          </span>
        </Link>

        {/* 导航菜单 */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                <span className="hidden md:inline-block">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
