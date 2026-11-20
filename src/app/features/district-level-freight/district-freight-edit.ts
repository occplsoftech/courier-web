import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { DistrictLevelFreight, CreateDistrictLevelFreightRequest, UpdateDistrictLevelFreightRequest } from '@core/models/district-level-freight.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { SelectOption } from '@shared/components/ui-select/ui-select';
import { MASTER_DEFINITIONS } from '@features/masters/master.config';
import { MasterDataService } from '@features/masters/master-data.service';
import { DistrictFreightForm } from './components/district-freight-form';
import { DistrictLevelFreightService } from './district-level-freight.service';

/** Edit — loads the row, PUTs a full replacement, handles 409 by reloading the latest. */
@Component({
  selector: 'app-district-freight-edit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiLoader, DistrictFreightForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Edit District Level Freight Rate</h1><p class="text-caption">Status has its own actions from the list.</p></div>
      </header>
      @if (loading()) {
        <app-loader [minHeight]="280" caption="Loading…" />
      } @else if (!row()) {
        <app-card><p class="empty">Rate not found or outside your scope.</p></app-card>
      } @else {
        <app-district-freight-form mode="edit" [row]="row()" [saving]="saving()"
          [branchOptions]="branchOptions()" [stateOptions]="stateOptions()" [districtOptions]="districtOptions()"
          [initialStateId]="initialStateId()"
          (stateChanged)="onStateChanged($event)" (saved)="save($event)" (cancelled)="cancel()" />
      }
    </div>
  `,
  styles: [`.empty{ font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:24px; }`]
})
export class DistrictFreightEdit implements OnInit {
  private readonly service = inject(DistrictLevelFreightService);
  private readonly masters = inject(MasterDataService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly row = signal<DistrictLevelFreight | null>(null);
  readonly branchOptions = signal<SelectOption[]>([]);
  readonly stateOptions = signal<SelectOption[]>([]);
  readonly districtOptions = signal<SelectOption[]>([]);
  readonly initialStateId = signal<string | null>(null);
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.masters.options('branches').subscribe((o) => this.branchOptions.set(o));
    this.masters.options('states').subscribe((o) => this.stateOptions.set(o));
    this.load();
  }

  /** District is a plain list of 637 nationally — larger than the 100-row page cap every
   *  master endpoint shares — so it only ever loads scoped to a chosen State, never in full. */
  onStateChanged(stateId: string | null): void {
    if (!stateId) { this.districtOptions.set([]); return; }
    this.masters.masterOptionsScoped('districts', { stateId }).subscribe((o) => this.districtOptions.set(o));
  }

  private load(): void {
    this.loading.set(true);
    this.service.get(this.id).subscribe({
      next: (r) => {
        this.breadcrumb.set([
          { label: 'District Level Freight', route: '/district-level-freight' },
          { label: `${r.branchName ?? r.branchCode} → ${r.districtName ?? r.districtCode}`, route: `/district-level-freight/${this.id}` },
          { label: 'Edit' }
        ]);
        // The row only carries districtId — the district's own record has the stateId
        // needed to scope District's options before the form ever shows, so the form
        // doesn't briefly render the existing district as an unmatched blank selection.
        this.masters.get(MASTER_DEFINITIONS.districts, r.districtId).subscribe({
          next: (district) => {
            const stateId = (district['stateId'] as string | null) ?? null;
            this.initialStateId.set(stateId);
            if (stateId) {
              this.masters.masterOptionsScoped('districts', { stateId }).subscribe((o) => {
                this.districtOptions.set(o);
                this.row.set(r);
                this.loading.set(false);
              });
            } else {
              this.row.set(r);
              this.loading.set(false);
            }
          },
          error: () => { this.row.set(r); this.loading.set(false); }
        });
      },
      error: () => { this.row.set(null); this.loading.set(false); }
    });
  }

  save(body: CreateDistrictLevelFreightRequest | UpdateDistrictLevelFreightRequest): void {
    this.saving.set(true);
    this.service.update(this.id, body as UpdateDistrictLevelFreightRequest).subscribe({
      next: () => { this.saving.set(false); this.notify.success('Rate updated.'); this.router.navigate(['/district-level-freight', this.id]); },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (err.status === 409) { this.notify.error('This rate changed since you opened it. Reloading the latest version.'); this.load(); }
        else if (err.status === 400 || err.status === 422) this.notify.error(err.error?.message ?? 'Please correct the highlighted fields.');
        else this.notify.error('Could not update the rate.');
      }
    });
  }

  cancel(): void { this.router.navigate(['/district-level-freight', this.id]); }
}
