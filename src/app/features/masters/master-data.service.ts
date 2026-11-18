import { Injectable, inject } from '@angular/core';
import { Observable, of, shareReplay } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '@core/services/api.service';
import { Page, PageQuery } from '@core/models/page.model';
import {
  MasterBootstrapResult, MasterOption, MasterRecord, PincodeAreaLookup, PincodeAreaRow, PincodeGeo, ServiceType
} from '@core/models/master.model';
import { LookupSource, MASTER_DEFINITIONS, MasterDefinition, MasterKey } from './master.config';

/** The branch fields this module reads — the two ends of a route, the postal code a
 *  booking screen defaults its pincode fields from, and the GST% (V25) it mirrors for its
 *  own Other Charges preview math. */
interface BranchSummary {
  id: string;
  branchCode: string;
  branchName: string;
  branchType?: string;
  status: string;
  city?: string | null;
  postalCode: string;
  gstPercentage: number;
  assignedHubId?: string | null;
}

/**
 * One service for twelve endpoints.
 *
 * The lists differ only in their path, and the path lives in the definition, so a generic
 * client is the honest shape here — twelve near-identical services would be twelve places
 * for the envelope handling to drift.
 *
 * Picker options are cached for the session: a create form for districts asks for the
 * state list, and opening five forms in a row should not be five requests. The cache is
 * dropped whenever this service writes, because the row just created is very often the one
 * the next form needs to pick.
 */
@Injectable({ providedIn: 'root' })
export class MasterDataService {
  private readonly api = inject(ApiService);

  /** Active rows per lookup source, cached until the next write. */
  private readonly optionCache = new Map<LookupSource, Observable<MasterOption[]>>();

  // --------------------------------------------------------------------- reads

  list(def: MasterDefinition, query: PageQuery): Observable<Page<MasterRecord>> {
    return this.api.page<MasterRecord>(def.apiPath, query);
  }

  get(def: MasterDefinition, id: string): Observable<MasterRecord> {
    return this.api.get<MasterRecord>(`${def.apiPath}/${id}`);
  }

  // -------------------------------------------------------------------- writes

  create(def: MasterDefinition, body: Record<string, unknown>): Observable<MasterRecord> {
    return this.tap(this.api.post<MasterRecord>(def.apiPath, body));
  }

  /** Full replacement. The body carries the `version` last read; a stale one is a 409. */
  update(def: MasterDefinition, id: string, body: Record<string, unknown>): Observable<MasterRecord> {
    return this.tap(this.api.put<MasterRecord>(`${def.apiPath}/${id}`, body));
  }

  /** Soft delete. Refused while the row still has children. */
  remove(def: MasterDefinition, id: string): Observable<void> {
    return this.tap(this.api.delete<void>(`${def.apiPath}/${id}`));
  }

  activate(def: MasterDefinition, id: string): Observable<MasterRecord> {
    return this.tap(this.api.patch<MasterRecord>(`${def.apiPath}/${id}/activate`, {}));
  }

  deactivate(def: MasterDefinition, id: string): Observable<MasterRecord> {
    return this.tap(this.api.patch<MasterRecord>(`${def.apiPath}/${id}/deactivate`, {}));
  }

  /** Seeds the standard catalogues. Idempotent — a second run reports everything skipped. */
  bootstrap(): Observable<MasterBootstrapResult> {
    return this.tap(this.api.post<MasterBootstrapResult>('/master/bootstrap', {}));
  }

  /**
   * Resolves the Area for a raw pincode via the postal directory, auto-creating whatever
   * State/District/City/Area rows are missing — so a possibly-new Area needs the same
   * cache invalidation a write does, not just the geography options being stale.
   */
  lookupPincodeArea(code: string): Observable<PincodeAreaLookup> {
    return this.tap(this.api.get<PincodeAreaLookup>(`/global-masters/pincodes/lookup/${code}`));
  }

  /** Area/City/District already on file for a pincode — read-only (no postal-directory
   *  call, nothing created), unlike {@link lookupPincodeArea}. What the consignment
   *  receipt uses so a BRANCH_MANAGER printing it doesn't need the COMPANY_ADMIN-only
   *  write audience `lookup/{code}` carries. Pass `areaId` (a shipment's own
   *  `destinationAreaId`) to resolve off that specific Area instead of the pincode's
   *  single fixed "primary" one — otherwise a pincode with several Areas always
   *  resolves to the same one regardless of which was actually selected. */
  pincodeGeo(code: string, areaId?: string | null): Observable<PincodeGeo> {
    return this.api.get<PincodeGeo>(`/global-masters/pincodes/${code}/geo`, areaId ? { areaId } : undefined);
  }

  /** Every Area a pincode's postal record names, primary row first — the detail page's
   *  own list, not the picker cache above. */
  pincodeAreas(pincodeId: string): Observable<PincodeAreaRow[]> {
    return this.api.get<PincodeAreaRow[]>(`/global-masters/pincodes/${pincodeId}/areas`);
  }

  /** Sets ODA (and/or its amount) for one Area of one pincode. Both fields optional and
   *  independent — send only what changed. */
  updatePincodeAreaOda(
    pincodeId: string, areaLinkId: string, body: { odaApplicable?: boolean; odaAmount?: number | null; serviceable?: boolean }
  ): Observable<PincodeAreaRow> {
    return this.api.patch<PincodeAreaRow>(`/global-masters/pincodes/${pincodeId}/areas/${areaLinkId}`, body);
  }

  // ------------------------------------------------------------------- lookups

  /**
   * Active rows of `source`, as picker options.
   *
   * Only active rows: offering an inactive parent would let a user build a form the
   * backend then refuses with 422, which is a worse experience than not seeing it.
   */
  options(source: LookupSource): Observable<MasterOption[]> {
    const cached = this.optionCache.get(source);
    if (cached) return cached;

    const request = source === 'branches' ? this.branchOptions() : this.masterOptions(source);
    const shared = request.pipe(shareReplay({ bufferSize: 1, refCount: false }));
    this.optionCache.set(source, shared);
    return shared;
  }

  /** Options for a set of sources at once, keyed by source. Used by the form and filters. */
  optionsFor(sources: LookupSource[]): Map<LookupSource, Observable<MasterOption[]>> {
    const map = new Map<LookupSource, Observable<MasterOption[]>>();
    for (const source of new Set(sources)) {
      map.set(source, this.options(source));
    }
    return map;
  }

  clearOptionCache(): void {
    this.optionCache.clear();
    this.branchDirectory$ = null;
    this.serviceTypeDirectory$ = null;
  }

  private masterOptions(key: MasterKey): Observable<MasterOption[]> {
    return this.masterOptionsScoped(key, {});
  }

  /**
   * Same shape as {@link options}, narrowed by extra query params (e.g. `stateId` for a
   * District picker cascading off a selected State) — used by the filter drawer's and the
   * create form's `dependsOn` fields. Not cached: the parent value changes often enough,
   * and each scoped list is small, that a per-combination cache would cost more than it
   * saves.
   *
   * The 200 requested here is aspirational, not authoritative — every master-list endpoint
   * hard-caps at 100 server-side (`MasterSortSupport.MAX_PAGE_SIZE`, deliberate, shared by
   * all twelve lists), so an unscoped call to a list bigger than that (districts: 637 and
   * climbing) silently truncates. A `dependsOn`-scoped call never hits this — one state's
   * districts are always well under 100 — so an unscoped picker over a list that size needs
   * its own narrowing field (see Cities' Country/State cascade), not a bigger page here.
   */
  masterOptionsScoped(key: MasterKey, params: Record<string, string>): Observable<MasterOption[]> {
    const def = MASTER_DEFINITIONS[key];
    if (!def) return of([]);
    return this.api
      .page<MasterRecord>(def.apiPath, { page: 0, size: 200, status: 'ACTIVE', ...params })
      .pipe(map((p) => p.content.map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))));
  }

  private branchDirectory$: Observable<BranchSummary[]> | null = null;

  /** `/branches/directory`, not the branch-scoped `/branches` list: a picker (Shipment
   *  Booking's delivery branch, the Rate Calculator) needs every active branch, not just
   *  the one a non-admin caller happens to manage or be assigned to. Cached for the
   *  session — the raw rows, so a caller that needs more than {value,label} (Shipment
   *  Booking's pincode defaulting needs `postalCode`) isn't limited to `MasterOption`. */
  branchDirectory(): Observable<BranchSummary[]> {
    if (!this.branchDirectory$) {
      this.branchDirectory$ = this.api.page<BranchSummary>('/branches/directory', {})
        .pipe(map((p) => p.content), shareReplay({ bufferSize: 1, refCount: false }));
    }
    return this.branchDirectory$;
  }

  /** The branch mapped to a pincode (`branch_pincode_mapping`'s one-branch rule), if any —
   *  Shipment Booking's Destination Pincode -> auto-select Delivery Branch flow. `undefined`
   *  when unmapped (the envelope's `data` key is simply absent). */
  branchForPincode(pincodeId: string): Observable<BranchSummary | undefined> {
    return this.api.get<BranchSummary>(`/branches/by-pincode/${pincodeId}`);
  }

  private branchOptions(): Observable<MasterOption[]> {
    return this.branchDirectory()
      .pipe(map((list) => list.map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` }))));
  }

  private serviceTypeDirectory$: Observable<ServiceType[]> | null = null;

  /** Raw Service Type rows, `deliveryDays` included — Shipment Booking's expected-delivery
   *  preview needs more than {value,label}. Cached like {@link branchDirectory}. */
  serviceTypeDirectory(): Observable<ServiceType[]> {
    if (!this.serviceTypeDirectory$) {
      this.serviceTypeDirectory$ = this.api
        .page<ServiceType>('/master/service-types', { page: 0, size: 200, status: 'ACTIVE' })
        .pipe(map((p) => p.content), shareReplay({ bufferSize: 1, refCount: false }));
    }
    return this.serviceTypeDirectory$;
  }

  /** Any write invalidates the picker cache — the new row is usually the next one picked. */
  private tap<T>(source: Observable<T>): Observable<T> {
    return new Observable<T>((subscriber) =>
      source.subscribe({
        next: (value) => {
          this.clearOptionCache();
          subscriber.next(value);
        },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete()
      })
    );
  }
}
