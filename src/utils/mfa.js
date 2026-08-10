export const FRESH_AAL2_MAX_AGE_SECONDS = 10 * 60;

export function getVerifiedTotpFactors(factors) {
  if (!Array.isArray(factors)) return [];
  return factors.filter((factor) => factor?.factor_type === 'totp' && factor?.status === 'verified');
}

export function hasTotpAal2(assurance) {
  return assurance?.currentLevel === 'aal2'
    && (assurance.currentAuthenticationMethods || []).some((method) => method?.method === 'mfa/totp');
}

export function hasFreshTotpAal2(assurance, nowSeconds = Math.floor(Date.now() / 1000), maxAgeSeconds = FRESH_AAL2_MAX_AGE_SECONDS) {
  if (!hasTotpAal2(assurance)) return false;
  return (assurance.currentAuthenticationMethods || []).some((method) => (
    method?.method === 'mfa/totp'
    && Number.isFinite(Number(method.timestamp))
    && Number(method.timestamp) >= nowSeconds - maxAgeSeconds
  ));
}

export function totpQrCodeDataUrl(qrCode) {
  if (!qrCode) return '';
  if (qrCode.startsWith('data:image/')) return qrCode;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`;
}

export function normalizeTotpCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}
