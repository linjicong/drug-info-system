'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Pill, Building2, ArrowRight, Database, RefreshCw, FileSpreadsheet, Layers, ClipboardList, History } from 'lucide-react';

/** 模块卡片配置 */
const modules = [
  {
    title: '广州药品采购平台',
    description: '广州公共资源交易中心药品采购平台公示信息抓取与管理',
    href: '/gz',
    icon: Pill,
    color: 'from-blue-500 to-cyan-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    borderColor: 'border-blue-200 dark:border-blue-800',
    features: ['药品公示信息抓取', '中标价格查询', '采购目录管理'],
    source: 'gpo.gzggzy.cn',
  },
  {
    title: '广东省医保局',
    description: '广东省医疗保障局挂网药品公示信息抓取与管理',
    href: '/pubonln',
    icon: Building2,
    color: 'from-emerald-500 to-teal-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    features: ['挂网药品信息抓取', '挂网价格查询', '质量层次分析'],
    source: 'igi.hsa.gd.gov.cn',
  },
  {
    title: '药品汇总表',
    description: '整合两个平台数据，统一字段展示，五字段联合去重',
    href: '/merged',
    icon: Layers,
    color: 'from-purple-500 to-violet-600',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    borderColor: 'border-purple-200 dark:border-purple-800',
    features: ['两表数据整合', '价格对比展示', '数据去重导出'],
    source: 'gd-medical + gz-gpo',
  },
  {
    title: '台账追踪配置',
    description: '维护需要持续监控的药品清单，支持手工维护与模板导入',
    href: '/ledger/track',
    icon: ClipboardList,
    color: 'from-amber-500 to-orange-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    borderColor: 'border-amber-200 dark:border-amber-800',
    features: ['监控药品维护', '模板下载导入', '追踪规则配置'],
    source: 'ledger tracked list',
  },
  {
    title: '台账历史查询',
    description: '查看每日台账快照与价格变化，支持按日期区间筛选和导出',
    href: '/ledger/history',
    icon: History,
    color: 'from-rose-500 to-pink-500',
    bgColor: 'bg-rose-50 dark:bg-rose-950/30',
    borderColor: 'border-rose-200 dark:border-rose-800',
    features: ['历史快照查询', '周一数据导出', '价格变化分析'],
    source: 'ledger snapshots',
  },
];

/** 系统功能亮点 */
const highlights = [
  {
    icon: Database,
    title: '数据抓取',
    description: '自动从官方平台抓取最新药品信息',
  },
  {
    icon: RefreshCw,
    title: '多条件筛选',
    description: '支持关键字、企业、医保类别等多条件组合查询',
  },
  {
    icon: FileSpreadsheet,
    title: '数据导出',
    description: '一键导出 Excel，便于离线分析使用',
  },
];

/**
 * 首页着陆页组件
 * 展示系统介绍和两个模块的入口卡片
 */
export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Hero 区域 */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 text-white mb-6 shadow-lg">
          <Pill className="w-8 h-8" />
        </div>
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
          药品信息管理系统
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
          集成广州药品采购平台与广东省医保局挂网药品数据，提供一站式药品信息查询、抓取与管理服务
        </p>
      </div>

      {/* 模块入口卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        {modules.map((module) => (
          <Link key={module.href} href={module.href} className="group">
            <Card className={`h-full transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${module.borderColor} ${module.bgColor}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${module.color} text-white shadow-md`}>
                    <module.icon className="w-6 h-6" />
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-300 group-hover:translate-x-1" />
                </div>
                <CardTitle className="text-xl mt-4">{module.title}</CardTitle>
                <CardDescription className="text-sm">
                  {module.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  {module.features.map((feature) => (
                    <Badge key={feature} variant="secondary" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  数据来源：{module.source}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* 系统功能亮点 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {highlights.map((item) => (
          <Card key={item.title} className="text-center">
            <CardContent className="pt-6">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
                <item.icon className="w-6 h-6 text-gray-600 dark:text-gray-400" />
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{item.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{item.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
