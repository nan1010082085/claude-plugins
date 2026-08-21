/**
 * 敏感路径检测：疑似密钥/凭证的文件不得进入 commit。
 */

/** 默认敏感路径匹配（basename 或路径片段） */
const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.env\.[^/]+$/i,
  /credentials\.(json|ya?ml|toml)$/i,
  /secret/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|\/)id_rsa$/i,
  /(^|\/)id_ed25519$/i,
  /\.key$/i,
  /service-account.*\.json$/i,
];

/**
 * 判断单个路径是否像密钥文件。
 * @param filePath - 相对或绝对路径
 */
export function looksLikeSecret(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return SECRET_PATTERNS.some((re) => re.test(normalized));
}

/**
 * 从文件列表中筛出疑似密钥路径。
 * @param files - 待检查路径
 */
export function findSecretFiles(files: string[]): string[] {
  return files.filter(looksLikeSecret);
}
