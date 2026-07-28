import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

/**
 * 生成 YYMMDD-HHMMSS 时间戳（gz / pubonln 导出文件名用）
 */
export function exportTimestamp(now: Date = new Date()): string {
  const year = String(now.getFullYear()).slice(2); // 两位年份
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

/**
 * 构建 Excel 导出响应
 * 列映射结果 + sheet 名 + 列宽 + 文件名由各路由提供，此处统一工作簿组装与响应头
 */
export function buildExcelResponse(params: {
  /** 已映射为中文列名的行数据 */
  rows: Record<string, unknown>[];
  /** 工作表名 */
  sheetName: string;
  /** 列宽配置 */
  colWidths: { wch: number }[];
  /** 完整文件名（含 .xlsx） */
  filename: string;
}): NextResponse {
  const { rows, sheetName, colWidths, filename } = params;

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(excelBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
