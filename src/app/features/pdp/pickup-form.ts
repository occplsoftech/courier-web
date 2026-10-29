import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { PickupRequest, SavePickupRequest } from '@core/models/pdp.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { PickupService } from './pickup.service';
import { PdpService } from './pdp.service';

const SLOTS: SelectOption[] = ['Morning (9-12)', 'Afternoon (12-4)', 'Evening (4-8)'].map((s) => ({ value: s, label: s }));

/** New / edit a pickup request. Optionally assigns a partner at once (create only). */
@Component({
  selector: 'app-pickup-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiInput, UiSelect, UiButton, UiLoader],
  template: `
    <div class="page">
      <header class="page__head"><div>
        <h1 class="text-h1">{{ editing() ? 'Edit ' + editing()!.pickupNo : 'New Pickup Request' }}</h1>
        <p class="text-caption">Where and what to collect.</p></div></header>
      @if (loading()) { <app-loader [minHeight]="240" caption="Loading…" /> } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="f">
          <app-card title="Contact &amp; address">
            <div class="grid">
              <app-input [control]="c('contactName')" label="Contact name" [maxLength]="150" />
              <app-input [control]="c('contactMobile')" label="Contact mobile" type="tel" [maxLength]="20" />
              <app-input [control]="c('pincode')" label="Pincode" [maxLength]="6" />
              <app-input class="wide" [control]="c('addressLine')" label="Pickup address" [maxLength]="255" />
              <app-input [control]="c('city')" label="City" [maxLength]="100" />
            </div>
          </app-card>
          <app-card title="Shipment &amp; schedule">
            <div class="grid">
              <app-input [control]="c('expectedParcels')" label="Expected parcels" type="number" [min]="1" />
              <app-input [control]="c('expectedWeightKg')" label="Expected weight (kg)" type="number" [min]="0" [step]="0.5" />
              <app-input [control]="c('preferredDate')" label="Preferred date" type="date" />
              <app-select [control]="c('preferredSlot')" label="Preferred slot" [options]="slots" [allowEmpty]="true" emptyLabel="Any time" placeholder="Any time" />
              @if (!editing()) {
                <app-select [control]="c('pdpBranchId')" label="Assign to partner (optional)" [options]="partners()" [allowEmpty]="true" emptyLabel="Assign later" placeholder="Assign later" />
              }
              <app-input class="wide" [control]="c('remarks')" label="Remarks" [maxLength]="500" />
            </div>
          </app-card>
          @if (photos().length) {
            <app-card title="Parcel photos from the customer" subtitle="Added by the customer when booking. Click one to open it full size.">
              <ul class="photos">
                @for (ph of photos(); track ph.id) {
                  <li>@if (ph.url) { <a [href]="ph.url" target="_blank" rel="noopener"><img [src]="ph.url" [alt]="ph.name" /></a> }</li>
                }
              </ul>
            </app-card>
          }
          <div class="bar">
            <app-button variant="stroked" (pressed)="back()">Cancel</app-button>
            <app-button type="submit" icon="save" [loading]="saving()">{{ editing() ? 'Save Changes' : 'Create Pickup' }}</app-button>
          </div>
        </form>
      }
    </div>
  `,
  styles: [`
    .f { display:flex; flex-direction:column; gap:16px; }
    .photos { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:12px; }
    .photos li { aspect-ratio:1; border-radius:10px; overflow:hidden; border:1px solid var(--surface-border); background:var(--surface-muted); }
    .photos img { width:100%; height:100%; object-fit:cover; display:block; }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 20px; align-items:end; }
    .wide { grid-column:span 2; } .bar { display:flex; justify-content:flex-end; gap:10px; }
    @media (max-width:860px){ .grid { grid-template-columns:1fr; } .wide { grid-column:auto; } }
  `]
})
export class PickupForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly svc = inject(PickupService);
  private readonly pdp = inject(PdpService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly id = this.route.snapshot.paramMap.get('id');
  protected readonly loading = signal(!!this.id);
  protected readonly saving = signal(false);
  protected readonly editing = signal<PickupRequest | null>(null);
  protected readonly partners = signal<SelectOption[]>([]);
  protected readonly slots = SLOTS;

  protected readonly form = this.fb.group({
    contactName: ['', [Validators.required, Validators.maxLength(150)]],
    contactMobile: ['', [Validators.required, Validators.pattern(/^[+]?[0-9 -]{7,20}$/)]],
    pincode: ['', [Validators.required, Validators.pattern(/^[0-9]{6}$/)]],
    addressLine: ['', [Validators.required, Validators.maxLength(255)]],
    city: [''],
    expectedParcels: [1, [Validators.required, Validators.min(1)]],
    expectedWeightKg: [null as number | null, [Validators.min(0)]],
    preferredDate: [''],
    preferredSlot: [''],
    pdpBranchId: [''],
    remarks: ['']
  });

  protected readonly photos = signal<{ id: string; name: string; url: string | null }[]>([]);

  /** The customer's parcel photos, fetched as blobs (the endpoint needs the sign-in header). A pickup without any shows nothing. */
  private loadPhotos(pickupId: string): void {
    this.svc.photos(pickupId).subscribe({
      next: (list) => {
        this.photos.set(list.map((p) => ({ id: p.id, name: p.fileName, url: null as string | null })));
        list.forEach((p) => this.svc.photoFile(pickupId, p.id).subscribe({
          next: (blob) => this.photos.update((l) => l.map((x) => x.id === p.id ? { ...x, url: URL.createObjectURL(blob) } : x)),
          error: () => undefined
        }));
      },
      error: () => undefined
    });
  }

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Pickup Delivery Partner Management' }, { label: 'Pickup Requests', route: '/pdp/pickups' }, { label: this.id ? 'Edit' : 'New' }]);
    this.pdp.partners({ page: 0, size: 200 }).subscribe((r) =>
      this.partners.set(r.content.filter((b) => b.status === 'ACTIVE').map((b) => ({ value: b.id, label: `${b.branchName} (${b.branchCode})` }))));
    if (this.id) {
      this.svc.get(this.id).subscribe({
        next: (p) => {
          this.editing.set(p);
          this.form.patchValue({
            contactName: p.contactName, contactMobile: p.contactMobile, pincode: p.pincode, addressLine: p.addressLine,
            city: p.city ?? '', expectedParcels: p.expectedParcels, expectedWeightKg: p.expectedWeightKg ?? null,
            preferredDate: p.preferredDate ?? '', preferredSlot: p.preferredSlot ?? '', remarks: p.remarks ?? ''
          });
          this.loading.set(false);
          this.loadPhotos(p.id);
        },
        error: () => { this.loading.set(false); this.back(); }
      });
    }
  }

  protected c(name: string) { return this.form.get(name) as import('@angular/forms').FormControl; }

  protected save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const body: SavePickupRequest = {
      contactName: v.contactName!.trim(), contactMobile: v.contactMobile!.trim(), addressLine: v.addressLine!.trim(),
      pincode: v.pincode!.trim(), city: v.city?.trim() || null,
      expectedParcels: v.expectedParcels ? Number(v.expectedParcels) : 1,
      expectedWeightKg: v.expectedWeightKg === null || v.expectedWeightKg === undefined || (v.expectedWeightKg as unknown) === '' ? null : Number(v.expectedWeightKg),
      preferredDate: v.preferredDate || null, preferredSlot: v.preferredSlot || null, remarks: v.remarks?.trim() || null,
      pdpBranchId: this.editing() ? null : (v.pdpBranchId || null), version: this.editing()?.version ?? null
    };
    this.saving.set(true);
    const e = this.editing();
    (e ? this.svc.update(e.id, body) : this.svc.create(body)).subscribe({
      next: (p) => { this.saving.set(false); this.notify.success(e ? 'Pickup saved.' : `Pickup ${p.pickupNo} created.`); this.back(); },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.notify.error(err.status === 409 ? 'This pickup changed since you opened it. Reload and try again.' : (err.error?.message ?? 'Could not save the pickup.'));
      }
    });
  }

  protected back(): void { this.router.navigate(['/pdp/pickups']); }
}
