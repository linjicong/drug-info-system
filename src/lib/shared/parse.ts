/**
 * 解析数字 - 处理各种类型的输入
 */
export function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  // 如果是数字，直接返回
  if (typeof value === 'number') return value;

  // 如果是字符串，尝试解析
  if (typeof value === 'string') {
    // 清理字符串，移除可能的非数字字符（除了小数点和负号）
    const cleaned = value.replace(/[^\d.-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  }

  // 如果是对象（例如 {68800 -4 false finite true}），尝试提取数字
  if (typeof value === 'object') {
    const objStr = JSON.stringify(value);
    // 提取第一个数字
    const match = objStr.match(/(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      // 检查是否是金额（通常以分为单位，需要转换为元）
      if (num >= 100) {
        return num / 100; // 转换为元
      }
      return num;
    }
    return undefined;
  }

  return undefined;
}

/**
 * 解析整数
 */
export function parseInteger(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;
  const num = parseInt(value, 10);
  return isNaN(num) ? undefined : num;
}
