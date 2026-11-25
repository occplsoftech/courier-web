/** Hostname → company code, for auto-filling login's company code field.
 *  Add an entry per company domain as they're provisioned. */
export const COMPANY_DOMAIN_MAP: Record<string, string> = {
  'vendor.amazinglpl.com': 'AMAZING_LOGISTICS'
};

/** Whole domains owned by one company: the domain itself and every subdomain
 *  (e.g. courier.dev.occplsoftech.com, courier.occplsoftech.com) sign in to that company by default. */
export const COMPANY_DOMAIN_SUFFIXES: Record<string, string> = {
  'occplsoftech.com': 'OCCPL'
};

/** Looks up the current hostname; undefined if no company owns this domain. */
export function companyCodeForHostname(hostname: string): string | undefined {
  const host = (hostname || '').toLowerCase();
  if (COMPANY_DOMAIN_MAP[host]) return COMPANY_DOMAIN_MAP[host];
  const suffix = Object.keys(COMPANY_DOMAIN_SUFFIXES).find((d) => host === d || host.endsWith('.' + d));
  return suffix ? COMPANY_DOMAIN_SUFFIXES[suffix] : undefined;
}
