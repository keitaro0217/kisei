// 認証の抽象化。現在はBasic認証のみだが、将来の個別アカウント・権限管理・多要素認証へ
// 差し替えられるよう、アプリ側は Principal と AuthProvider だけに依存する。

export type Permission =
  | 'research:read'
  | 'research:run'
  | 'settings:read'
  | 'settings:write'
  | 'credentials:write'
  | 'audit:read';

export type Principal = {
  /** 監査ログに記録する識別子（パスワード等は含めない） */
  id: string;
  displayName: string;
  /** 将来の金融機関（テナント）単位の分離用。Basic認証では単一テナント */
  tenantId: string;
  permissions: Permission[];
  authMethod: 'basic' | 'development';
};

export type AuthResult =
  | { ok: true; principal: Principal }
  | { ok: false; reason: 'missing' | 'invalid' | 'misconfigured' };

export interface AuthProvider {
  readonly name: string;
  authenticate(headers: Headers): AuthResult;
  /** 401 応答に付与する WWW-Authenticate ヘッダー値 */
  challenge(): string;
}

export const ALL_PERMISSIONS: Permission[] = [
  'research:read',
  'research:run',
  'settings:read',
  'settings:write',
  'credentials:write',
  'audit:read',
];
