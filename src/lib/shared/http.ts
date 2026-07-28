import https from 'https';

/**
 * 使用 Node.js https 模块发起请求
 */
export function httpsPost(options: https.RequestOptions, postData: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      // 设置编码为 utf8，避免多字节字符被截断
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
