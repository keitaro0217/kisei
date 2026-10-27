import type { SecurityStatus } from '@/lib/research/types';
import { getBasicAuthConfig, getAllowedPrivateHosts, getEgressProxyUrl, isProduction } from '../env';
import { isEncryptionConfigured } from '../crypto/secretBox';
import { getConfig } from '../storage/store';

export async function getSecurityStatus(): Promise<SecurityStatus> {
  const basic = getBasicAuthConfig();
  const state = await getConfig();
  return {
    basicAuth: {
      enabled: Boolean(basic),
      mode: basic ? 'enforced' : 'disabled_dev',
      httpsEnforced: isProduction(),
    },
    encryption: { configured: isEncryptionConfigured(), algorithm: 'AES-256-GCM' },
    providers: state.providers.map((p) => ({ id: p.id, name: p.name, hasApiKey: Boolean(p.encryptedApiKey), apiKeyUpdatedAt: p.apiKeyUpdatedAt })),
    egressProxy: getEgressProxyUrl() !== null,
    allowedPrivateHosts: getAllowedPrivateHosts(),
  };
}
