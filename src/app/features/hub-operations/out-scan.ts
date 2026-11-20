import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { AuthService } from '@core/auth/auth.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { Manifest, MovementOutcome } from '@core/models/shipment.model';
import { ManifestService } from '@features/manifest/manifest.service';
import { MasterDataService } from '@features/masters/master-data.service';
import { HubOperationsService } from './hub-operations.service';

/**
 * Out Scan — before a hub-originated Load Sheet may dispatch, every shipment on it must
 * be confirmed physically present. Picking a Load Sheet lists its `MANIFEST_CREATED`
 * shipments (unscanned first); scanning an AWB (or typing it) confirms one at a time. A
 * shipment already out-scanned, not on this Load Sheet, or not physically here is
 * rejected — see `HubOperationsService.outScan`. Dispatch itself happens on the
 * Dispatch screen (Trip Hire Challan), reused as-is.
 */
@Component({
  selector: 'app-hub-out-scan',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, UiCard, UiButton, UiInput, UiLoader],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Out Scan</h1><p class="text-caption">Confirm shipments physically present before dispatch.</p></div>
        <app-button variant="stroked" icon="refresh" (pressed)="loadOpenManifests()">Refresh</app-button>
      </header>

      @if (!myBranchId) {
        <app-card><p class="empty">No hub assigned — ask an admin.</p></app-card>
      } @else if (!activeManifest()) {
        <app-card title="Load Sheets ready for Out Scan">
          @if (loadingManifests()) {
            <app-loader [minHeight]="100" caption="Loading…" />
          } @else if (!openManifests().length) {
            <p class="empty">No Load Sheet from your hub is awaiting out-scan.</p>
          } @else {
            <div class="ml">
              @for (m of openManifests(); track m.id) {
                <div class="mrow">
                  <div><strong>{{ m.manifestNumber }}</strong>
                    <span class="text-caption">{{ m.shipmentCount }} shipment(s) · {{ m.totalWeight }} kg</span></div>
                  <app-button (pressed)="selectManifest(m)">Out Scan</app-button>
                </div>
              }
            </div>
          }
        </app-card>
      } @else {
        <app-card>
          <div class="mh">
            <div><strong>{{ activeManifest()!.manifestNumber }}</strong>
              <span class="text-caption">{{ scannedCount() }} scanned</span></div>
            <app-button variant="stroked" icon="close" (pressed)="activeManifest.set(null)">Done</app-button>
          </div>
        </app-card>

        <app-card title="Scan">
          <div class="row" (keydown.enter)="scanOne()">
            <app-input [control]="scanControl" label="AWB / Tracking Number" placeholder="Scan or type…" />
            <app-button icon="qr_code_scanner" [loading]="scanning()" (pressed)="scanOne()">Scan</app-button>
          </div>
        </app-card>

        @if (outcomes().length) {
          <app-card title="Scan Log">
            <div class="ol">
              @for (o of outcomes(); track o.reference) {
                <div class="ol__row" [class.ol__row--fail]="!o.success">
                  <span>{{ o.success ? '✓' : '✗' }}</span> {{ o.reference }} — {{ o.message || (o.success ? 'Out-scanned' : 'Failed') }}
                </div>
              }
            </div>
          </app-card>
        }
      }
    </div>
  `,
  styles: [`
    .page__head { display:flex; justify-content:space-between; align-items:flex-start; }
    .empty { font:400 17px var(--font-sans); color:var(--content-muted); text-align:center; padding:20px; }
    .ml { display:flex; flex-direction:column; gap:8px; }
    .mrow { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-top:1px solid var(--surface-border); }
    .mrow:first-child { border-top:none; }
    .mh { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .mh strong { display:block; font:600 18px var(--font-sans); }
    .row { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; }
    .row app-input { flex:1; min-width:200px; }
    .ol { display:flex; flex-direction:column; gap:6px; }
    .ol__row { display:flex; align-items:center; gap:8px; font:400 16px var(--font-sans); color:var(--success-600, #16a34a); }
    .ol__row--fail { color:var(--danger-600, #dc2626); }
  `]
})
export class HubOutScan implements OnInit {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly manifestService = inject(ManifestService);
  private readonly hubOperationsService = inject(HubOperationsService);

  protected readonly myBranchId = this.auth.user()?.branchId ?? null;
  readonly loadingManifests = signal(true);
  readonly openManifests = signal<Manifest[]>([]);
  readonly activeManifest = signal<Manifest | null>(null);
  readonly scanning = signal(false);
  readonly outcomes = signal<MovementOutcome[]>([]);
  readonly scannedCount = computed(() => this.outcomes().filter((o) => o.success).length);

  readonly scanControl = new FormControl('');

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Hub Operations' }, { label: 'Out Scan' }]);
    this.loadOpenManifests();
  }

  loadOpenManifests(): void {
    if (!this.myBranchId) return;
    this.loadingManifests.set(true);
    this.manifestService.list({
      page: 0, size: 50, status: 'CREATED', bookingBranchId: this.myBranchId, sort: 'createdAt,desc',
      flowType: 'STANDARD'
    }).subscribe({
      next: (p) => { this.openManifests.set(p.content); this.loadingManifests.set(false); },
      error: () => { this.openManifests.set([]); this.loadingManifests.set(false); }
    });
  }

  selectManifest(m: Manifest): void {
    this.activeManifest.set(m);
    this.outcomes.set([]);
  }

  scanOne(): void {
    const raw = this.scanControl.value?.trim();
    const manifest = this.activeManifest();
    if (!raw || !manifest || !this.myBranchId) return;
    this.scanControl.setValue('');
    this.scanning.set(true);
    this.hubOperationsService.outScan({
      manifestId: manifest.id, hubBranchId: this.myBranchId, trackingNumbers: [raw]
    }).subscribe({
      next: (outcomes) => {
        this.scanning.set(false);
        this.outcomes.update((prev) => [...outcomes, ...prev]);
        const o = outcomes[0];
        if (o && !o.success) this.notify.error(o.message || 'Scan failed.');
      },
      error: (e) => { this.scanning.set(false); this.notify.error(e.error?.message ?? 'Scan failed.'); }
    });
  }
}
