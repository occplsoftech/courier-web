import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CreateCustomerRequest } from '@core/models/customer.model';
import { CustomerForm } from './customer-form';

/**
 * The GST-mandatory-for-BUSINESS rule mirrors the server's `Customer.applyInvariants()` —
 * this is the client-side half of it, so the error surfaces before the round-trip.
 */
describe('CustomerForm — GST is mandatory only for a business customer', () => {
  let fixture: ComponentFixture<CustomerForm>;
  let form: CustomerForm;

  const group = () => (form as unknown as { form: { patchValue: (v: object) => void; get: (n: string) => { valid: boolean } } }).form;

  const emitted = (): CreateCustomerRequest | undefined => {
    let body: CreateCustomerRequest | undefined;
    fixture.componentInstance.saved.subscribe((b) => (body = b as CreateCustomerRequest));
    (form as unknown as { submit: () => void }).submit();
    return body;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CustomerForm],
      providers: [provideNoopAnimations()]
    });
    fixture = TestBed.createComponent(CustomerForm);
    fixture.componentRef.setInput('mode', 'create');
    form = fixture.componentInstance;
    fixture.detectChanges();

    group().patchValue({
      firstName: 'Asha', lastName: 'Shah', mobile: '9876543210'
    });
  });

  it('accepts an individual customer with no GST', () => {
    group().patchValue({ customerType: 'INDIVIDUAL' });
    fixture.detectChanges();

    const body = emitted();
    expect(body).toBeDefined();
    expect(body!.gstNumber).toBeNull();
  });

  it('refuses to submit a business customer with a blank GST', () => {
    group().patchValue({ customerType: 'BUSINESS' });
    fixture.detectChanges();

    expect(emitted()).toBeUndefined();
  });

  it('accepts a business customer once a valid GSTIN is supplied, uppercased', () => {
    group().patchValue({ customerType: 'BUSINESS', gstNumber: '27abcde1234f1z5' });
    fixture.detectChanges();

    const body = emitted();
    expect(body).toBeDefined();
    expect(body!.gstNumber).toBe('27ABCDE1234F1Z5');
  });

  it('generates no code client-side — a blank customerCode is sent as null', () => {
    group().patchValue({ customerType: 'INDIVIDUAL' });
    fixture.detectChanges();

    expect(emitted()!.customerCode).toBeNull();
  });

  it('a business customer carries its zone type (Default unless Customize is chosen); an individual does not', () => {
    let picked: string | undefined;
    fixture.componentInstance.zoneTypePicked.subscribe((z) => (picked = z));
    group().patchValue({ customerType: 'BUSINESS', gstNumber: '27ABCDE1234F1Z5' });
    fixture.detectChanges();
    expect(emitted()).toBeDefined();
    expect(picked).toBe('DEFAULT');

    (form as unknown as { zoneType: { set: (v: string) => void } }).zoneType.set('CUSTOMIZE');
    emitted();
    expect(picked).toBe('CUSTOMIZE');

    picked = undefined;
    group().patchValue({ customerType: 'INDIVIDUAL' });
    fixture.detectChanges();
    emitted();
    expect(picked).toBeUndefined();
  });
});
