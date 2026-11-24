import { pageIconFor } from './page-icon';

describe('pageIconFor', () => {
  it('uses the page\'s own menu icon', () => {
    expect(pageIconFor('/movement/scan')).toBe('qr_code_scanner');
    expect(pageIconFor('/shipments/quick-booking')).toBe('bolt');
  });
  it('uses the menu item a detail page sits under, ignoring query strings', () => {
    expect(pageIconFor('/shipments/quick-booking?x=1')).toBe('bolt');
    expect(pageIconFor('/courier-integrations/abc')).toBe(pageIconFor('/courier-integrations'));
  });
  it('falls back to a plain page icon', () => {
    expect(pageIconFor('/no-such-page')).toBe('description');
  });
});
