import { defaultSlabs, isDocumentPackage } from './rate-card-form';

describe('rate card lane defaults', () => {
  it('tells Document from Non Document package types', () => {
    expect(isDocumentPackage('Document (DOC)')).toBe(true);
    expect(isDocumentPackage('Non Document (NONDOC)')).toBe(false);
    expect(isDocumentPackage('Non-Document')).toBe(false);
    expect(isDocumentPackage('Parcel (PCL)')).toBe(false);
  });

  it('starts a Document lane at 500 g fixed, then every extra 500 g', () => {
    expect(defaultSlabs(true)).toEqual([
      { weightFromKg: 0.001, weightToKg: 0.5, rateType: 'FIXED', rate: 0, stepKg: null },
      { weightFromKg: 0.501, weightToKg: 99, rateType: 'PER_EXTRA_KG', rate: 0, stepKg: 0.5 }
    ]);
  });

  it('starts a Non Document lane at 500 g fixed, then every extra 1 kg', () => {
    expect(defaultSlabs(false)[1]).toEqual({ weightFromKg: 0.501, weightToKg: 99, rateType: 'PER_EXTRA_KG', rate: 0, stepKg: 1 });
  });

  it('keeps the general template until a package type is chosen', () => {
    expect(defaultSlabs().length).toBe(4);
  });
});
