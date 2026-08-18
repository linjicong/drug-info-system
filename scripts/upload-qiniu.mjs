/**
 * 七牛云上传脚本（Desktop Release 流水线调用，也可本地手动执行）：
 * 将 release/ 下的安装包产物（*.exe + latest.yml）上传到七牛存储空间，
 * 作为桌面应用自动更新的国内分发源（配合 electron/updater.cjs）。
 * latest.yml 最后上传，保证用户读到更新清单时安装包已就位。
 *
 * 必需环境变量：QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET
 * 可选环境变量：
 *   QINIU_ZONE            存储区域，如 z0/z1/z2/cn-east-2/na0/as0；留空则自动探测桶所在区域
 *   RELEASE_PATH_PREFIX   桶内目录前缀，默认 drug-info-system/releases（须与 UPDATE_URL 路径一致）
 */
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const qiniu = require('qiniu');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const prefix = (process.env.RELEASE_PATH_PREFIX || 'drug-info-system/releases').replace(/\/+$/, '');

const accessKey = process.env.QINIU_ACCESS_KEY;
const secretKey = process.env.QINIU_SECRET_KEY;
const bucket = process.env.QINIU_BUCKET;
if (!accessKey || !secretKey || !bucket) {
  console.error('❌ 缺少必需环境变量：QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET');
  process.exit(1);
}

const ZONES = {
  z0: qiniu.zone.Zone_z0,
  'cn-east-1': qiniu.zone.Zone_z0,
  'cn-east-2': qiniu.zone.Zone_cn_east_2,
  z1: qiniu.zone.Zone_z1,
  'cn-north-1': qiniu.zone.Zone_z1,
  z2: qiniu.zone.Zone_z2,
  'cn-south-1': qiniu.zone.Zone_z2,
  na0: qiniu.zone.Zone_na0,
  as0: qiniu.zone.Zone_as0,
};
const zoneName = (process.env.QINIU_ZONE || '').toLowerCase();
const zone = ZONES[zoneName];
if (zoneName && !zone) {
  console.warn(`⚠️ 未知 QINIU_ZONE=${zoneName}，将自动探测桶所在区域`);
}

const config = new qiniu.conf.Config();
// 未配置（或配置无效）时不指定 zone，SDK 通过 UC API 自动探测桶所在区域，
// 避免区域不匹配报 incorrect region
if (zone) config.zone = zone;

const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
const resumeUploader = new qiniu.resume_up.ResumeUploader(config);

/** 断点续传上传单个文件；scope 带 key 表示允许覆盖同名对象 */
function uploadFile(localFile, key) {
  return new Promise((resolve, reject) => {
    const token = new qiniu.rs.PutPolicy({ scope: `${bucket}:${key}`, expires: 7200 }).uploadToken(mac);
    const putExtra = qiniu.resume_up.PutExtra.create(); // 默认 v2 分片上传
    resumeUploader.putFile(token, key, localFile, putExtra, (err, body, info) => {
      if (err) {
        reject(err);
        return;
      }
      if (info.statusCode !== 200) {
        reject(new Error(`HTTP ${info.statusCode}: ${JSON.stringify(body)}`));
        return;
      }
      resolve();
    });
  });
}

// 产物清单：exe 先传，latest.yml 最后
const entries = readdirSync(releaseDir).filter((name) => name.endsWith('.exe') || name === 'latest.yml');
const ordered = entries.filter((n) => n !== 'latest.yml').concat(entries.filter((n) => n === 'latest.yml'));
if (ordered.length === 0) {
  console.error('❌ release/ 下没有可上传的产物（*.exe / latest.yml）');
  process.exit(1);
}

for (const name of ordered) {
  const key = `${prefix}/${name}`;
  console.log(`⬆️ 上传 ${name} → ${bucket}/${key}`);
  try {
    await uploadFile(path.join(releaseDir, name), key);
    console.log(`   ✅ ${name} 上传完成`);
  } catch (error) {
    console.error(`❌ ${name} 上传失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// latest.yml 是同名覆盖上传，CDN 会按 max-age 长期缓存旧清单（表现为客户端
// 检查更新无反应）；上传完成后主动刷新缓存，让新版本立即对客户端可见
const updateUrl = process.env.UPDATE_URL;
if (updateUrl) {
  const latestUrl = `${updateUrl.replace(/\/+$/, '')}/latest.yml`;
  const cdnManager = new qiniu.cdn.CdnManager(mac);
  await new Promise((resolve) => {
    cdnManager.refreshUrls([latestUrl], (err, body, info) => {
      if (err || (info && info.statusCode !== 200)) {
        console.warn(
          `⚠️ latest.yml CDN 缓存刷新失败${err ? `：${err.message}` : `（HTTP ${info && info.statusCode}）`}，请到七牛控制台手动刷新：${latestUrl}`,
        );
      } else {
        console.log(`✅ latest.yml CDN 缓存已刷新：${latestUrl}`);
      }
      resolve();
    });
  });
} else {
  console.warn('ℹ️ 未设置 UPDATE_URL，跳过 CDN 缓存刷新；如配置了 CDN 域名请手动刷新 latest.yml');
}
console.log(`🎉 全部上传完成，更新源地址：${updateUrl || `<UPDATE_URL 未设置>/${prefix}/`}`);
