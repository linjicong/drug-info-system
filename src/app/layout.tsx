import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import { AppHeader } from '@/components/drug/AppHeader';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '药品信息查询系统',
    template: '%s | 药品信息查询系统',
  },
  description:
    '药品信息查询系统，提供广州药品采购平台公示信息查询、广东省医保局挂网药品查询及数据分析服务。',
  keywords: [
    '药品信息',
    '挂网药品',
    '药品采购',
    '医保药品',
    '药品价格',
    '广东医保',
    '药品公示',
    '广州采购',
  ],
  authors: [{ name: 'Drug Info System' }],
  generator: 'Next.js',
  openGraph: {
    title: '药品信息查询系统',
    description:
      '提供广州药品采购平台公示信息查询、广东省医保局挂网药品查询及数据分析服务。',
    siteName: '药品信息查询系统',
    locale: 'zh_CN',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * 根布局组件
 * 包含全局导航头和页面内容插槽
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="en">
      <body className={`antialiased`}>
        {isDev && <Inspector />}
        <AppHeader />
        <main className="min-h-[calc(100vh-4rem)]">
          {children}
        </main>
      </body>
    </html>
  );
}
