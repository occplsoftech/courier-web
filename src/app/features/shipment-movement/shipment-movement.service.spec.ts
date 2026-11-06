import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@env/environment';
import { ShipmentMovementService } from './shipment-movement.service';

/** Dispatch -> In Scan -> Out For Delivery -> Deliver — each a POST to its own
 *  /shipment-movement sub-route, mirroring ShipmentMovementController one-to-one. Out
 *  Scan is no longer a separate step (V20) — see ManifestService.create instead. */
describe('ShipmentMovementService', () => {
  const base = environment.apiBaseUrl;
  let service: ShipmentMovementService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ShipmentMovementService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(ShipmentMovementService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('dispatches a manifest with the vehicle and driver', () => {
    service.dispatch({ manifestId: 'mft-1', vehicleId: 'veh-1', driverUserId: 'usr-1' }).subscribe();
    const request = http.expectOne(`${base}/shipment-movement/dispatch`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.vehicleId).toBe('veh-1');
    request.flush({ success: true, data: {} });
  });

  it('in-scans a batch at the receiving branch', () => {
    service.inScan({ receivingBranchId: 'b-2', trackingNumbers: ['AWB1'] }).subscribe();
    const request = http.expectOne(`${base}/shipment-movement/in-scan`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.receivingBranchId).toBe('b-2');
    request.flush({ success: true, data: { results: [], successCount: 0, failureCount: 0 } });
  });

  it('assigns a delivery user to a batch of shipments', () => {
    service.outForDelivery({ shipmentIds: ['shp-1', 'shp-2'], deliveryUserId: 'usr-1' }).subscribe();
    const request = http.expectOne(`${base}/shipment-movement/out-for-delivery`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.shipmentIds).toEqual(['shp-1', 'shp-2']);
    request.flush({ success: true, data: { results: [], successCount: 0, failureCount: 0 } });
  });

  it('records a failed delivery attempt with its reason and note', () => {
    service.markUndelivered('shp-9', 'RECEIVER_NOT_AVAILABLE', 'door locked').subscribe();
    const request = http.expectOne(`${base}/shipment-movement/shp-9/undelivered`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ reason: 'RECEIVER_NOT_AVAILABLE', note: 'door locked' });
    request.flush({ success: true, data: {} });
  });

  it('closes a delivery with receiver name required, everything else optional', () => {
    service.deliver({ shipmentId: 'shp-1', receiverName: 'Rahul Verma' }).subscribe();
    const request = http.expectOne(`${base}/shipment-movement/deliver`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.receiverName).toBe('Rahul Verma');
    request.flush({ success: true, data: {} });
  });
});
