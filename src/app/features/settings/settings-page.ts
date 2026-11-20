import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiLoader } from '@shared/components/ui-loader/ui-loader';
import { SettingsService } from './settings.service';
import { RazorpayConfigService, RazorpayConfigResponse, RazorpayMode } from './razorpay-config.service';
import { SettingsSectionDialog, SectionField } from './components/settings-section-dialog';

interface Section { key: string; title: string; icon: string; desc: string; }

/** Field definitions per section, matching CompanySettingsRequest's flat field set. Keys
 *  must match the backend DTO exactly — the PATCH endpoints ignore anything else. */
const SECTION_FIELDS: Record<string, SectionField[]> = {
  general: [
    { key: 'companyName', label: 'Company name', type: 'text' },
    { key: 'displayName', label: 'Display name', type: 'text' },
    { key: 'supportEmail', label: 'Support email', type: 'text' },
    { key: 'supportMobile', label: 'Support mobile', type: 'text' },
    { key: 'website', label: 'Website', type: 'text' },
    { key: 'language', label: 'Language', type: 'text' },
    { key: 'timezone', label: 'Timezone', type: 'text' },
    { key: 'currency', label: 'Currency (3-letter code)', type: 'text' },
    { key: 'country', label: 'Country', type: 'text' },
    { key: 'state', label: 'State', type: 'text' },
    { key: 'city', label: 'City', type: 'text' }
  ],
  sla: [
    { key: 'slaBreachTicketEnabled', label: 'Auto-raise ticket on SLA breach', type: 'checkbox' },
    { key: 'slaBookingToLoadingSheetHours', label: 'Booking → Loading Sheet (hours)', type: 'number', min: 1, max: 720 },
    { key: 'slaLoadingSheetToThcHours', label: 'Loading Sheet → THC (hours)', type: 'number', min: 1, max: 720 },
    { key: 'slaThcToInscanHours', label: 'THC → Inscan (hours)', type: 'number', min: 1, max: 720 },
    { key: 'slaInscanToDrsHours', label: 'Inscan → DRS (hours)', type: 'number', min: 1, max: 720 },
    { key: 'slaDrsToDeliveryHours', label: 'DRS → Delivery (hours)', type: 'number', min: 1, max: 720 }
  ],
  notification: [
    { key: 'smsEnabled', label: 'SMS', type: 'checkbox' },
    { key: 'emailEnabled', label: 'Email', type: 'checkbox' },
    { key: 'whatsappEnabled', label: 'WhatsApp', type: 'checkbox' },
    { key: 'pushNotificationEnabled', label: 'Push notifications', type: 'checkbox' }
  ],
  security: [
    { key: 'passwordPolicy', label: 'Password policy', type: 'text' },
    { key: 'sessionTimeoutMinutes', label: 'Session timeout (minutes)', type: 'number', min: 1, max: 1440 },
    { key: 'maxLoginAttempts', label: 'Max login attempts', type: 'number', min: 1, max: 20 },
    { key: 'lockDurationMinutes', label: 'Lock duration (minutes)', type: 'number', min: 1, max: 1440 },
    { key: 'otpExpiryMinutes', label: 'OTP expiry (minutes)', type: 'number', min: 1, max: 60 }
  ],
  branding: [
    { key: 'companyLogo', label: 'Logo URL', type: 'text' },
    { key: 'favicon', label: 'Favicon URL', type: 'text' },
    { key: 'primaryColor', label: 'Primary colour (#rrggbb)', type: 'text' },
    { key: 'secondaryColor', label: 'Secondary colour (#rrggbb)', type: 'text' },
    {
      key: 'theme', label: 'Theme', type: 'select',
      options: [
        { value: 'LIGHT', label: 'Light' },
        { value: 'DARK', label: 'Dark' },
        { value: 'SYSTEM', label: 'System' }
      ]
    }
  ]
};

/** Company Settings — the eight sections from the backend, loaded from /company-settings.
 *  General, SLA, Notification, Security and Branding open a generic field-driven dialog
 *  (see SECTION_FIELDS below) that PATCHes just that section; Shipment's weight and
 *  Finance's Razorpay config keep their own inline widgets since they predate the dialog. */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, UiCard, UiLoader],
  template: `
    <div class="page">
      <header><h1 class="text-h1">Company Settings</h1><p class="text-caption">Configure how the platform behaves for your company.</p></header>
      @if (loading()) {
        <app-loader [minHeight]="240" caption="Loading settings…" />
      } @else {
        <div class="grid">
          @for (s of sections; track s.key) {
            <app-card [title]="s.title" [subtitle]="s.desc">
              @if (editableSections.has(s.key)) {
                <div card-actions>
                  <button class="edit" type="button" (click)="editSection(s.key)"><mat-icon>edit</mat-icon></button>
                </div>
              }
              <div class="kv">
                @for (row of preview(s.key); track row.k) {
                  <div class="kv__row"><span class="text-caption">{{ row.k }}</span><span class="kv__v">{{ row.v }}</span></div>
                }
              </div>
              @if (s.key === 'shipment') {
                <div class="dcw">
                  <label class="text-caption" for="dac-input">Default Appointment Delivery Charge</label>
                  <div class="dcw__row">
                    <input id="dac-input" class="dcw__i" type="number" step="0.01" min="0"
                           [value]="defaultAppointmentChargeInput() ?? ''" (input)="onAppointmentChargeInput($event)" />
                    <button type="button" class="dcw__save" [disabled]="savingAppointmentCharge() || defaultAppointmentChargeInput() == null"
                            (click)="saveDefaultAppointmentCharge()">{{ savingAppointmentCharge() ? 'Saving…' : 'Save' }}</button>
                  </div>
                </div>
                <div class="dcw">
                  <label class="text-caption" for="tpc-input">To-Pay Charge (added to every To-Pay booking, GST applies; 0 turns it off)</label>
                  <div class="dcw__row">
                    <input id="tpc-input" class="dcw__i" type="number" step="0.01" min="0"
                           [value]="toPayChargeInput() ?? ''" (input)="onToPayChargeInput($event)" />
                    <button type="button" class="dcw__save" [disabled]="savingToPayCharge() || toPayChargeInput() == null"
                            (click)="saveToPayCharge()">{{ savingToPayCharge() ? 'Saving…' : 'Save' }}</button>
                  </div>
                </div>
                <div class="dcw">
                  <label class="rzp__check">
                    <input type="checkbox" [checked]="manualStatusOverrideInput()" [disabled]="savingManualOverride()"
                           (change)="onManualStatusOverrideToggle($event)" />
                    <span>Allow manual shipment status override on Trip Hire Challan (COMPANY_ADMIN / BRANCH_MANAGER)</span>
                  </label>
                  <span class="text-caption">Lets a company admin or branch manager force a shipment straight to In Scan, Out For Delivery, Delivered or any other status from the THC tracking screen, bypassing the normal flow. Off by default.</span>
                </div>
              }
              @if (s.key === 'finance') {
                <div class="dcw">
                  <label class="text-caption" for="gst-input">GST Percentage</label>
                  <div class="dcw__row">
                    <input id="gst-input" class="dcw__i" type="number" min="0" max="100" step="0.01"
                           [value]="gstPercentageInput() ?? ''" (input)="onGstPercentageInput($event)" />
                    <button type="button" class="dcw__save" [disabled]="savingGst() || gstPercentageInput() == null"
                            (click)="saveGstPercentage()">{{ savingGst() ? 'Saving…' : 'Save' }}</button>
                  </div>
                </div>
                <div class="rzp">
                  <div class="rzp__head">
                    <span class="text-caption">Payment Gateway (Razorpay)</span>
                    <span class="rzp__badge"
                          [class.rzp__badge--on]="razorpayModeInput() === 'LIVE' ? razorpay()?.liveKeySecretConfigured : razorpay()?.testKeySecretConfigured">
                      {{ (razorpayModeInput() === 'LIVE' ? razorpay()?.liveKeySecretConfigured : razorpay()?.testKeySecretConfigured) ? 'Configured' : 'Not configured' }}
                    </span>
                  </div>
                  <label class="rzp__check">
                    <input type="checkbox" [checked]="razorpayEnabledInput()"
                           (change)="onRazorpayEnabledInput($event)" />
                    <span>Use this company's own Razorpay account</span>
                  </label>

                  <div class="rzp__field">
                    <span class="text-caption">Active Mode</span>
                    <div class="rzp__toggle" role="group" aria-label="Active Mode">
                      <button type="button" class="rzp__toggle-btn"
                              [class.rzp__toggle-btn--active]="razorpayModeInput() === 'TEST'"
                              (click)="setRazorpayMode('TEST')">Test</button>
                      <button type="button" class="rzp__toggle-btn"
                              [class.rzp__toggle-btn--active]="razorpayModeInput() === 'LIVE'"
                              (click)="setRazorpayMode('LIVE')">Live</button>
                    </div>
                  </div>

                  <div class="rzp__group">
                    <span class="rzp__group-title">Test credentials</span>
                    <div class="rzp__row2">
                      <div class="rzp__field">
                        <label class="text-caption" for="rzp-test-key-id">Key ID</label>
                        <input id="rzp-test-key-id" class="dcw__i" type="text" placeholder="rzp_test_…"
                               autocomplete="off" name="rzp-test-key-id-nofill"
                               [value]="razorpayTestKeyIdInput()" (input)="onRazorpayTestKeyIdInput($event)" />
                      </div>
                      <div class="rzp__field">
                        <label class="text-caption" for="rzp-test-key-secret">Key Secret</label>
                        <input id="rzp-test-key-secret" class="dcw__i" type="password"
                               autocomplete="new-password" name="rzp-test-key-secret-nofill"
                               [placeholder]="razorpay()?.testKeySecretConfigured ? 'Leave blank to keep existing' : 'rzp test secret'"
                               [value]="razorpayTestKeySecretInput()" (input)="onRazorpayTestKeySecretInput($event)" />
                      </div>
                    </div>
                  </div>

                  <div class="rzp__group">
                    <span class="rzp__group-title">Live credentials</span>
                    <div class="rzp__row2">
                      <div class="rzp__field">
                        <label class="text-caption" for="rzp-live-key-id">Key ID</label>
                        <input id="rzp-live-key-id" class="dcw__i" type="text" placeholder="rzp_live_…"
                               autocomplete="off" name="rzp-live-key-id-nofill"
                               [value]="razorpayLiveKeyIdInput()" (input)="onRazorpayLiveKeyIdInput($event)" />
                      </div>
                      <div class="rzp__field">
                        <label class="text-caption" for="rzp-live-key-secret">Key Secret</label>
                        <input id="rzp-live-key-secret" class="dcw__i" type="password"
                               autocomplete="new-password" name="rzp-live-key-secret-nofill"
                               [placeholder]="razorpay()?.liveKeySecretConfigured ? 'Leave blank to keep existing' : 'rzp live secret'"
                               [value]="razorpayLiveKeySecretInput()" (input)="onRazorpayLiveKeySecretInput($event)" />
                      </div>
                    </div>
                  </div>

                  <div class="dcw__row">
                    <button type="button" class="dcw__save" [disabled]="savingRazorpay()"
                            (click)="saveRazorpay()">{{ savingRazorpay() ? 'Saving…' : 'Save' }}</button>
                  </div>
                </div>
                <div class="dcw">
                  <label class="text-caption" for="round-off-select">Round Off (Shipment Booking's final amount)</label>
                  <div class="dcw__row">
                    <select id="round-off-select" class="dcw__i" [value]="roundOffRuleInput()"
                            (change)="onRoundOffInput($event)">
                      <option value="NONE">No rounding</option>
                      <option value="NEAREST_ONE">Nearest 1</option>
                      <option value="NEAREST_FIVE">Nearest 5</option>
                      <option value="NEAREST_TEN">Nearest 10</option>
                    </select>
                    <button type="button" class="dcw__save" [disabled]="savingRoundOff()"
                            (click)="saveRoundOff()">{{ savingRoundOff() ? 'Saving…' : 'Save' }}</button>
                  </div>
                </div>
                <div class="dcw">
                  <label class="text-caption">Net Amount edit bounds (Shipment Booking's editable preview)</label>
                  <div class="dcw__row">
                    <input class="dcw__i" type="number" min="0" max="100" step="0.01"
                           placeholder="Max decrease %"
                           [value]="netAmountMaxDecreaseInput() ?? ''" (input)="onNetAmountMaxDecreaseInput($event)" />
                    <input class="dcw__i" type="number" min="0" max="999.99" step="0.01"
                           placeholder="Max increase %"
                           [value]="netAmountMaxIncreaseInput() ?? ''" (input)="onNetAmountMaxIncreaseInput($event)" />
                    <button type="button" class="dcw__save" [disabled]="savingNetAmountBounds()"
                            (click)="saveNetAmountBounds()">{{ savingNetAmountBounds() ? 'Saving…' : 'Save' }}</button>
                  </div>
                </div>
              }
            </app-card>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    .kv{display:flex;flex-direction:column;gap:10px}
    .kv__row{display:flex;justify-content:space-between;gap:16px}
    .kv__v{font:600 16px var(--font-sans);color:var(--content-fg);text-align:right}
    .edit{border:1px solid var(--surface-border);background:var(--surface);border-radius:8px;width:32px;height:32px;display:grid;place-items:center;cursor:pointer;color:var(--content-muted)}
    .dcw{margin-top:12px;padding-top:12px;border-top:1px solid var(--surface-border);display:flex;flex-direction:column;gap:6px}
    .dcw__row{display:flex;gap:8px;flex-wrap:wrap}
    .dcw__i{flex:1;height:36px;padding:0 10px;background:var(--surface);border:1px solid var(--surface-border);border-radius:8px;font:400 16px var(--font-sans);color:var(--content-fg)}
    .dcw__i:focus{outline:0;border-color:var(--brand-500)}
    .dcw__save{height:36px;padding:0 14px;border:0;border-radius:8px;background:var(--brand-600);color:#fff;font:600 16px var(--font-sans);cursor:pointer}
    .dcw__save:disabled{opacity:.5;cursor:not-allowed}
    .rzp{margin-top:12px;padding-top:12px;border-top:1px solid var(--surface-border);display:flex;flex-direction:column;gap:6px}
    .rzp__head{display:flex;justify-content:space-between;align-items:center}
    .rzp__badge{font:600 14px var(--font-sans);padding:2px 8px;border-radius:999px;background:var(--surface-muted);color:var(--content-muted)}
    .rzp__badge--on{background:var(--brand-100,#e0e7ff);color:var(--brand-700,#3730a3)}
    .rzp__check{display:flex;align-items:center;gap:8px;font:400 16px var(--font-sans);color:var(--content-fg);margin:4px 0}
    .rzp__field{flex:1;min-width:160px;display:flex;flex-direction:column;gap:4px}
    .rzp__group{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--surface-border);border-radius:8px;background:var(--surface-muted)}
    .rzp__group-title{font:600 14px var(--font-sans);text-transform:uppercase;letter-spacing:.04em;color:var(--content-muted)}
    .rzp__row2{display:flex;gap:10px;flex-wrap:wrap}
    .rzp__toggle{display:inline-flex;padding:2px;border:1px solid var(--surface-border);border-radius:8px;background:var(--surface);width:fit-content}
    .rzp__toggle-btn{height:30px;padding:0 16px;border:0;border-radius:6px;background:transparent;color:var(--content-muted);font:600 16px var(--font-sans);cursor:pointer}
    .rzp__toggle-btn--active{background:var(--brand-600);color:#fff}
    @media (max-width:900px){.grid{grid-template-columns:1fr}}
  `]
})
export class SettingsPage implements OnInit {
  private readonly service = inject(SettingsService);
  private readonly razorpayService = inject(RazorpayConfigService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  readonly loading = signal(true);
  readonly data = signal<Record<string, unknown>>({});
  readonly editableSections = new Set(Object.keys(SECTION_FIELDS));

  /** Shipment's inline fields — no full edit dialog yet. (Default chargeable weight is
   *  retired: chargeable weight is always the higher of actual and volumetric.) */
  readonly defaultAppointmentChargeInput = signal<number | null>(null);
  readonly savingAppointmentCharge = signal(false);
  readonly toPayChargeInput = signal<number | null>(null);
  readonly savingToPayCharge = signal(false);

  /** Shipment's third inline field — a plain toggle, saved immediately on change (no
   *  separate Save button, unlike the two numeric fields above). Gates whether a
   *  COMPANY_ADMIN/BRANCH_MANAGER can use Trip Hire Challan's "Change Status" action —
   *  see `TripHireChallan`/`ShipmentMovementService.overrideStatus`. */
  readonly manualStatusOverrideInput = signal(false);
  readonly savingManualOverride = signal(false);

  /** A company's own Razorpay account, loaded separately from the rest of settings —
   *  it's its own COMPANY_ADMIN-only backend resource, not part of /company-settings. */
  readonly razorpay = signal<RazorpayConfigResponse | null>(null);
  readonly razorpayEnabledInput = signal(false);
  readonly razorpayModeInput = signal<RazorpayMode>('TEST');
  readonly razorpayTestKeyIdInput = signal('');
  readonly razorpayTestKeySecretInput = signal('');
  readonly razorpayLiveKeyIdInput = signal('');
  readonly razorpayLiveKeySecretInput = signal('');
  readonly savingRazorpay = signal(false);

  /** Finance's first inline field — same "no full edit dialog yet" treatment as
   *  Razorpay/Round Off/Net Amount bounds below. */
  readonly gstPercentageInput = signal<number | null>(null);
  readonly savingGst = signal(false);

  /** Finance's second inline field — same "no full edit dialog yet" treatment as
   *  Razorpay above and Shipment's default weight. */
  readonly roundOffRuleInput = signal('NEAREST_FIVE');
  readonly savingRoundOff = signal(false);

  /** Finance's third inline field — bounds on Shipment Booking's editable Net Amount
   *  preview (see `ShipmentCreate.manualNetAmount`), same "no full edit dialog yet"
   *  treatment as Razorpay/Round Off above. */
  readonly netAmountMaxDecreaseInput = signal<number | null>(10);
  readonly netAmountMaxIncreaseInput = signal<number | null>(50);
  readonly savingNetAmountBounds = signal(false);

  readonly sections: Section[] = [
    { key: 'general', title: 'General', icon: 'business', desc: 'Identity, contact and regional defaults.' },
    { key: 'shipment', title: 'Shipment', icon: 'local_shipping', desc: 'AWB prefixes, units and booking rules.' },
    { key: 'finance', title: 'Finance', icon: 'payments', desc: 'GST, invoicing, wallet and COD.' },
    { key: 'sla', title: 'SLA', icon: 'schedule', desc: 'Hours before a stuck shipment auto-raises a ticket.' },
    { key: 'notification', title: 'Notification', icon: 'notifications', desc: 'SMS, email, WhatsApp and push.' },
    { key: 'security', title: 'Security', icon: 'shield', desc: 'Password policy, sessions and OTP.' },
    { key: 'branding', title: 'Branding', icon: 'palette', desc: 'Logo, colours and theme.' }
  ];

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Settings' }]);
    this.service.get().subscribe({
      next: (d) => {
        this.data.set(d ?? {});
        const shipment = (d as { shipment?: {
          defaultAppointmentDeliveryCharge?: number; toPayCharge?: number;
          manualStatusOverrideEnabled?: boolean;
        } })?.shipment;
        if (shipment?.defaultAppointmentDeliveryCharge != null) {
          this.defaultAppointmentChargeInput.set(Number(shipment.defaultAppointmentDeliveryCharge));
        }
        if (shipment?.toPayCharge != null) this.toPayChargeInput.set(Number(shipment.toPayCharge));
        this.manualStatusOverrideInput.set(shipment?.manualStatusOverrideEnabled === true);
        const finance = (d as { finance?: {
          gstPercentage?: number; roundOffRule?: string; netAmountMaxDecreasePercent?: number; netAmountMaxIncreasePercent?: number;
        } })?.finance;
        if (finance?.gstPercentage != null) {
          this.gstPercentageInput.set(Number(finance.gstPercentage));
        }
        if (finance?.roundOffRule) {
          this.roundOffRuleInput.set(finance.roundOffRule);
        }
        if (finance?.netAmountMaxDecreasePercent != null) {
          this.netAmountMaxDecreaseInput.set(Number(finance.netAmountMaxDecreasePercent));
        }
        if (finance?.netAmountMaxIncreasePercent != null) {
          this.netAmountMaxIncreaseInput.set(Number(finance.netAmountMaxIncreasePercent));
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
    this.razorpayService.get().subscribe({
      next: (r) => {
        this.razorpay.set(r);
        this.razorpayEnabledInput.set(r.enabled);
        this.razorpayModeInput.set(r.mode);
        this.razorpayTestKeyIdInput.set(r.testKeyId ?? '');
        this.razorpayLiveKeyIdInput.set(r.liveKeyId ?? '');
      },
      error: () => { /* Settings is COMPANY_ADMIN-only already; nothing further to show. */ }
    });
  }

  onAppointmentChargeInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.defaultAppointmentChargeInput.set(v === '' ? null : Number(v));
  }

  saveDefaultAppointmentCharge(): void {
    const value = this.defaultAppointmentChargeInput();
    if (value == null || value < 0) return;
    this.savingAppointmentCharge.set(true);
    this.service.patchSection('shipment', { defaultAppointmentDeliveryCharge: value }).subscribe({
      next: (d) => {
        const shipment = (d as { shipment?: unknown })?.shipment;
        if (shipment) this.data.update((prev) => ({ ...prev, shipment }));
        this.savingAppointmentCharge.set(false);
        this.notify.success('Default appointment delivery charge updated');
      },
      error: () => this.savingAppointmentCharge.set(false)
    });
  }

  onToPayChargeInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.toPayChargeInput.set(v === '' ? null : Number(v));
  }

  saveToPayCharge(): void {
    const value = this.toPayChargeInput();
    if (value == null || value < 0) return;
    this.savingToPayCharge.set(true);
    this.service.patchSection('shipment', { toPayCharge: value }).subscribe({
      next: (d) => {
        const shipment = (d as { shipment?: unknown })?.shipment;
        if (shipment) this.data.update((prev) => ({ ...prev, shipment }));
        this.savingToPayCharge.set(false);
        this.notify.success('To-Pay charge updated');
      },
      error: () => this.savingToPayCharge.set(false)
    });
  }

  onManualStatusOverrideToggle(e: Event): void {
    const checked = (e.target as HTMLInputElement).checked;
    this.manualStatusOverrideInput.set(checked);
    this.savingManualOverride.set(true);
    this.service.patchSection('shipment', { manualStatusOverrideEnabled: checked }).subscribe({
      next: (d) => {
        const shipment = (d as { shipment?: unknown })?.shipment;
        if (shipment) this.data.update((prev) => ({ ...prev, shipment }));
        this.savingManualOverride.set(false);
        this.notify.success(checked ? 'Manual status override enabled' : 'Manual status override disabled');
      },
      error: () => { this.manualStatusOverrideInput.set(!checked); this.savingManualOverride.set(false); }
    });
  }

  onRazorpayEnabledInput(e: Event): void {
    this.razorpayEnabledInput.set((e.target as HTMLInputElement).checked);
  }

  setRazorpayMode(mode: RazorpayMode): void {
    this.razorpayModeInput.set(mode);
  }

  onRazorpayTestKeyIdInput(e: Event): void {
    this.razorpayTestKeyIdInput.set((e.target as HTMLInputElement).value);
  }

  onRazorpayTestKeySecretInput(e: Event): void {
    this.razorpayTestKeySecretInput.set((e.target as HTMLInputElement).value);
  }

  onRazorpayLiveKeyIdInput(e: Event): void {
    this.razorpayLiveKeyIdInput.set((e.target as HTMLInputElement).value);
  }

  onRazorpayLiveKeySecretInput(e: Event): void {
    this.razorpayLiveKeySecretInput.set((e.target as HTMLInputElement).value);
  }

  saveRazorpay(): void {
    this.savingRazorpay.set(true);
    this.razorpayService.update({
      enabled: this.razorpayEnabledInput(),
      mode: this.razorpayModeInput(),
      testKeyId: this.razorpayTestKeyIdInput().trim(),
      testKeySecret: this.razorpayTestKeySecretInput().trim() || null,
      liveKeyId: this.razorpayLiveKeyIdInput().trim(),
      liveKeySecret: this.razorpayLiveKeySecretInput().trim() || null
    }).subscribe({
      next: (r) => {
        this.razorpay.set(r);
        // Never leave a raw secret sitting in the DOM/memory longer than it takes to save.
        this.razorpayTestKeySecretInput.set('');
        this.razorpayLiveKeySecretInput.set('');
        this.savingRazorpay.set(false);
        this.notify.success('Razorpay configuration updated');
      },
      error: () => this.savingRazorpay.set(false)
    });
  }

  onGstPercentageInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.gstPercentageInput.set(v === '' ? null : Number(v));
  }

  saveGstPercentage(): void {
    const value = this.gstPercentageInput();
    if (value == null) return;
    this.savingGst.set(true);
    this.service.patchSection('finance', { gstPercentage: value }).subscribe({
      next: (d) => {
        const finance = (d as { finance?: unknown })?.finance;
        if (finance) this.data.update((prev) => ({ ...prev, finance }));
        this.savingGst.set(false);
        this.notify.success('GST percentage updated');
      },
      error: () => this.savingGst.set(false)
    });
  }

  onRoundOffInput(e: Event): void {
    this.roundOffRuleInput.set((e.target as HTMLSelectElement).value);
  }

  saveRoundOff(): void {
    this.savingRoundOff.set(true);
    this.service.patchSection('finance', { roundOffRule: this.roundOffRuleInput() }).subscribe({
      next: (d) => {
        const finance = (d as { finance?: unknown })?.finance;
        if (finance) this.data.update((prev) => ({ ...prev, finance }));
        this.savingRoundOff.set(false);
        this.notify.success('Round off rule updated');
      },
      error: () => this.savingRoundOff.set(false)
    });
  }

  onNetAmountMaxDecreaseInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.netAmountMaxDecreaseInput.set(v === '' ? null : Number(v));
  }

  onNetAmountMaxIncreaseInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.netAmountMaxIncreaseInput.set(v === '' ? null : Number(v));
  }

  saveNetAmountBounds(): void {
    const decrease = this.netAmountMaxDecreaseInput();
    const increase = this.netAmountMaxIncreaseInput();
    if (decrease == null || increase == null) return;
    this.savingNetAmountBounds.set(true);
    this.service.patchSection('finance', {
      netAmountMaxDecreasePercent: decrease, netAmountMaxIncreasePercent: increase
    }).subscribe({
      next: (d) => {
        const finance = (d as { finance?: unknown })?.finance;
        if (finance) this.data.update((prev) => ({ ...prev, finance }));
        this.savingNetAmountBounds.set(false);
        this.notify.success('Net Amount edit bounds updated');
      },
      error: () => this.savingNetAmountBounds.set(false)
    });
  }

  editSection(section: string): void {
    const fields = SECTION_FIELDS[section];
    if (!fields) return;
    const d = this.data() as Record<string, Record<string, unknown>>;
    const values = d[section] ?? {};
    const sectionMeta = this.sections.find((s) => s.key === section);

    this.dialog.open(SettingsSectionDialog, {
      data: { title: `Edit ${sectionMeta?.title ?? section}`, fields, values },
      panelClass: 'app-dialog'
    }).afterClosed().subscribe((result?: Record<string, unknown>) => {
      if (!result) return;
      this.service.patchSection(section, result).subscribe({
        next: (updated) => {
          const patched = (updated as Record<string, unknown>)[section];
          if (patched) this.data.update((prev) => ({ ...prev, [section]: patched }));
          this.notify.success(`${sectionMeta?.title ?? 'Section'} settings updated`);
        },
        error: (err) => this.notify.error(err?.error?.message ?? 'Could not update settings.')
      });
    });
  }

  /** A few representative keys per section, read from the live settings object. */
  preview(section: string): { k: string; v: string }[] {
    const d = this.data() as Record<string, Record<string, unknown>>;
    const s = d[section] ?? {};
    // defaultChargeableWeightKg is retired (no minimum chargeable weight); not shown.
    return Object.entries(s).filter(([k]) => k !== 'defaultChargeableWeightKg').slice(0, 4).map(([k, v]) => ({
      k: k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
      v: v === null || v === undefined || v === '' ? '—' : String(v)
    }));
  }
}
