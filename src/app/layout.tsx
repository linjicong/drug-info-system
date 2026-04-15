import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '药品信息查询系统',
    template: '%s | 药品信息查询系统',
  },
  description:
    '药品信息查询系统，提供广东省挂网药品信息查询、药品采购公示查询及数据分析服务。',
  keywords: [
    '药品信息',
    '挂网药品',
    '药品采购',
    '医保药品',
    '药品价格',
    '广东医保',
    '药品公示',
  ],
  authors: [{ name: 'Drug Info System' }],
  generator: 'Next.js',
  openGraph: {
    title: '药品信息查询系统',
    description:
      '提供广东省挂网药品信息查询、药品采购公示查询及数据分析服务。',
    siteName: '药品信息查询系统',
    locale: 'zh_CN',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
  },
};

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
        {children}
      </body>
    </html>
  );
}
