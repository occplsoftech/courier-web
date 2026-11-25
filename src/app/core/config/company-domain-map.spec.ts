import { companyCodeForHostname } from './company-domain-map';

describe('companyCodeForHostname', () => {
  it('defaults OCCPL on occplsoftech.com and its subdomains', () => {
    expect(companyCodeForHostname('courier.dev.occplsoftech.com')).toBe('OCCPL');
    expect(companyCodeForHostname('courier.occplsoftech.com')).toBe('OCCPL');
    expect(companyCodeForHostname('occplsoftech.com')).toBe('OCCPL');
  });
  it('keeps exact entries and ignores look-alike domains', () => {
    expect(companyCodeForHostname('vendor.amazinglpl.com')).toBe('AMAZING_LOGISTICS');
    expect(companyCodeForHostname('evil-occplsoftech.com')).toBeUndefined();
    expect(companyCodeForHostname('localhost')).toBeUndefined();
  });
});
