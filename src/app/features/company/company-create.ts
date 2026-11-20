import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { SubscriptionPlanOption } from '@core/models/company.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiSelect, SelectOption } from '@shared/components/ui-select/ui-select';
import { TemporaryPasswordDialog } from '@features/platform/components/temporary-password-dialog';
import { CompanyLogo } from './components/company-logo';
import { CompanyService, GeographyOption } from './company.service';

function toOptions(rows: GeographyOption[]): SelectOption[] {
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

// Mirrors CreateCompanyRequest's own patterns, so the same input is refused in the same
// place rather than surviving the form and coming back as an opaque "Request validation
// failed" 400 — the client-side gap this form previously had for every field but companyCode.
const PHONE = /^[+]?[0-9 \-]{7,20}$/;
const WEBSITE = /^$|^https?:\/\/.+/;
const GSTIN = /^$|^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z][Zz][0-9A-Za-z]$/;
const PAN = /^$|^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;

/**
 * Create a company. `SUPER_ADMIN` only — it is the one thing on the platform that only a
 * platform operator can bring into existence.
 *
 * <p>Its own form rather than a reuse of `CompanyForm`: that one edits an existing
 * company, so it has no `companyCode` (immutable, and therefore create-only) and no first
 * administrator. Bending it to do both would have meant a `mode` flag threaded through
 * every field.
 *
 * <p>The admin block is optional. Left blank, the first administrator is created at the
 * company's own address — which is what a small operator actually wants, and saves them
 * typing the same address twice.
 */
@Component({
  selector: 'app-company-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatIconModule, UiButton, UiCard, UiInput, UiSelect, CompanyLogo],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">New Company</h1>
          <p class="text-caption">Creates the company, its roles and settings, and its first administrator.</p>
        </div>
      </header>

      <form [formGroup]="form" (ngSubmit)="submit()">
        <app-card title="Identity" subtitle="The code is permanent — operational records will quote it.">
          <div class="grid">
            <app-input [control]="c('companyCode')" label="Company code" [required]="true"
              placeholder="ACME_LOGISTICS" [maxLength]="50"
              errorMessage="2–50 characters: letters, digits, hyphen or underscore" />
            <app-input [control]="c('companyName')" label="Company name" [required]="true" [maxLength]="150" />
            <app-input [control]="c('legalName')" label="Legal name" [maxLength]="200" />
            <app-input [control]="c('displayName')" label="Display name" [maxLength]="100" />
            <app-select [control]="c('subscriptionPlanId')" label="Subscription plan" [options]="planOptions()" />
          </div>
          <p class="hint">
            <mat-icon>info</mat-icon>
            If the plan grants trial days the company starts on trial; otherwise it starts active.
          </p>
        </app-card>

        <app-card title="Contact">
          <div class="grid">
            <app-input [control]="c('email')" label="Email" type="email" [required]="true" [maxLength]="255" />
            <app-input [control]="c('mobile')" label="Mobile" type="tel" [required]="true" [maxLength]="20" />
            <app-input [control]="c('alternateMobile')" label="Telephone" type="tel" [maxLength]="20" />
            <app-input [control]="c('website')" label="Website" [maxLength]="255" />
          </div>
        </app-card>

        <app-card title="Registration">
          <div class="grid">
            <app-input [control]="c('gstNumber')" label="GSTIN" [maxLength]="15" />
            <app-input [control]="c('panNumber')" label="PAN" [maxLength]="10" />
            <app-input [control]="c('cinNumber')" label="CIN" [maxLength]="21" />
          </div>
        </app-card>

        <app-card title="Address" subtitle="Country → State → District → City narrows the picker; only the selected names are saved.">
          <div class="grid">
            <app-input [control]="c('addressLine1')" label="Address line 1" [maxLength]="255" />
            <app-input [control]="c('addressLine2')" label="Address line 2" [maxLength]="255" />
            <app-select [control]="c('countryId')" label="Country" [options]="countryOpts()"
                        [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a country" />
            <app-select [control]="c('stateId')" label="State" [options]="stateOpts()"
                        [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a country first" />
            <app-select [control]="c('districtId')" label="District" [options]="districtOpts()"
                        [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a state first" />
            <app-select [control]="c('cityId')" label="City" [options]="cityOpts()"
                        [allowEmpty]="true" emptyLabel="Not set" placeholder="Select a district first" />
            <app-input [control]="c('postalCode')" label="Pincode" [maxLength]="20" />
          </div>
        </app-card>

        <app-card title="Branding" subtitle="Logo shown in the header once the company signs in.">
          <app-company-logo [editable]="true" [logoControl]="c('logo')" [faviconControl]="c('favicon')" />
        </app-card>

        <app-card title="First administrator"
          subtitle="Leave blank to use the company's own email and mobile.">
          <div class="grid">
            <app-input [control]="c('adminEmail')" label="Admin email" type="email" [maxLength]="255" />
            <app-input [control]="c('adminMobile')" label="Admin mobile" type="tel" [maxLength]="20" />
            <app-input [control]="c('adminFirstName')" label="First name" [maxLength]="100" />
            <app-input [control]="c('adminLastName')" label="Last name" [maxLength]="100" />
          </div>
          <p class="hint">
            <mat-icon>vpn_key</mat-icon>
            The account is created pending, with a temporary password shown to you once on
            the next screen, and an activation email. The password alone opens nothing
            until the activation link is followed.
          </p>
        </app-card>

        <div class="actions">
          <app-button variant="stroked" type="button" (pressed)="cancel()">Cancel</app-button>
          <app-button type="submit" icon="add_business" [disabled]="saving() || form.invalid">
            {{ saving() ? 'Creating…' : 'Create company' }}
          </app-button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    form { display:flex; flex-direction:column; gap:16px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    .hint { display:flex; gap:8px; margin:14px 0 0; color:var(--content-muted); font-size:15px; line-height:1.55; }
    .hint mat-icon { font-size:18px; width:18px; height:18px; flex:none; }
    .actions { display:flex; justify-content:flex-end; gap:10px; }
    @media (max-width:760px){ .grid{ grid-template-columns:1fr; } }
  `]
})
export class CompanyCreatePage implements OnInit {
  private readonly service = inject(CompanyService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly saving = signal(false);
  readonly plans = signal<SubscriptionPlanOption[]>([]);

  readonly form = this.fb.group({
    // Mirrors the backend's own pattern, so the same input is refused in the same place
    // rather than surviving the form and coming back as a 400.
    companyCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9_-]{1,48}[A-Za-z0-9]$/), Validators.maxLength(50)]],
    companyName: ['', [Validators.required, Validators.maxLength(150)]],
    legalName: ['', Validators.maxLength(200)],
    displayName: ['', Validators.maxLength(100)],
    subscriptionPlanId: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
    mobile: ['', [Validators.required, Validators.pattern(PHONE), Validators.maxLength(20)]],
    alternateMobile: ['', [Validators.pattern(PHONE), Validators.maxLength(20)]],
    website: ['', [Validators.pattern(WEBSITE), Validators.maxLength(255)]],
    gstNumber: ['', [Validators.pattern(GSTIN), Validators.maxLength(15)]],
    panNumber: ['', [Validators.pattern(PAN), Validators.maxLength(10)]],
    cinNumber: ['', Validators.maxLength(21)],
    addressLine1: ['', Validators.maxLength(255)],
    addressLine2: ['', Validators.maxLength(255)],
    countryId: [null as string | null],
    stateId: [null as string | null],
    districtId: [null as string | null],
    cityId: [null as string | null],
    postalCode: ['', Validators.maxLength(20)],
    logo: ['', Validators.maxLength(500)],
    favicon: ['', Validators.maxLength(500)],
    adminEmail: ['', [Validators.email, Validators.maxLength(255)]],
    adminMobile: ['', [Validators.pattern(PHONE), Validators.maxLength(20)]],
    adminFirstName: ['', Validators.maxLength(100)],
    adminLastName: ['', Validators.maxLength(100)]
  });

  private readonly countries = signal<GeographyOption[]>([]);
  private readonly states = signal<GeographyOption[]>([]);
  private readonly districts = signal<GeographyOption[]>([]);
  private readonly cities = signal<GeographyOption[]>([]);

  protected readonly countryOpts = computed(() => toOptions(this.countries()));
  protected readonly stateOpts = computed(() => toOptions(this.states()));
  protected readonly districtOpts = computed(() => toOptions(this.districts()));
  protected readonly cityOpts = computed(() => toOptions(this.cities()));

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Companies', route: '/companies' }, { label: 'New' }]);
    this.service.plans().subscribe({
      next: (plans) => this.plans.set(plans),
      error: () => this.plans.set([])
    });
    this.service.countries().subscribe((rows) => this.countries.set(rows));

    this.c('countryId').valueChanges.subscribe((id) => this.cascade('state', id));
    this.c('stateId').valueChanges.subscribe((id) => this.cascade('district', id));
    this.c('districtId').valueChanges.subscribe((id) => this.cascade('city', id));
  }

  /** Clears and reloads everything beneath the level just changed. */
  private cascade(level: 'state' | 'district' | 'city', parentId: string | null): void {
    const resetLists: Record<string, () => void> = {
      state: () => { this.states.set([]); this.districts.set([]); this.cities.set([]); },
      district: () => { this.districts.set([]); this.cities.set([]); },
      city: () => this.cities.set([])
    };
    resetLists[level]();

    if (!parentId) return;
    switch (level) {
      case 'state': this.service.states(parentId).subscribe((rows) => this.states.set(rows)); break;
      case 'district': this.service.districts(parentId).subscribe((rows) => this.districts.set(rows)); break;
      case 'city': this.service.cities(parentId).subscribe((rows) => this.cities.set(rows)); break;
    }
  }

  /** Resolves the picked id back to the plain name the backend actually stores. */
  private nameOf(rows: GeographyOption[], id: string | null): string | null {
    return id ? (rows.find((r) => r.id === id)?.name ?? null) : null;
  }

  /**
   * The generic "Request validation failed" message names no field — the actual
   * `field: message` pairs travel in `errors[]` (ApiResponse.FieldError) but nothing in
   * this app has ever surfaced them, so a rejected field was previously invisible.
   */
  private errorMessage(err: unknown): string {
    const body = (err as { error?: { message?: string; errors?: { field: string; message: string }[] } })?.error;
    if (body?.errors?.length) {
      return body.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
    }
    return body?.message ?? 'Could not create the company.';
  }

  planOptions() {
    return this.plans().map((p) => ({ value: p.id, label: `${p.planName} (${p.planCode})` }));
  }

  c(name: string): FormControl {
    return this.form.get(name) as FormControl;
  }

  cancel(): void {
    this.router.navigate(['/companies']);
  }

  submit(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);

    const raw = this.form.getRawValue();
    this.service.create({
      companyCode: (raw.companyCode ?? '').trim(),
      companyName: (raw.companyName ?? '').trim(),
      legalName: raw.legalName || null,
      displayName: raw.displayName || null,
      subscriptionPlanId: raw.subscriptionPlanId!,
      email: (raw.email ?? '').trim(),
      mobile: (raw.mobile ?? '').trim(),
      alternateMobile: raw.alternateMobile || null,
      website: raw.website || null,
      gstNumber: raw.gstNumber || null,
      panNumber: raw.panNumber || null,
      cinNumber: raw.cinNumber || null,
      logo: raw.logo || null,
      favicon: raw.favicon || null,
      addressLine1: raw.addressLine1 || null,
      addressLine2: raw.addressLine2 || null,
      country: this.nameOf(this.countries(), raw.countryId),
      state: this.nameOf(this.states(), raw.stateId),
      city: this.nameOf(this.cities(), raw.cityId),
      postalCode: raw.postalCode || null,
      adminEmail: raw.adminEmail ? raw.adminEmail.trim() : null,
      adminMobile: raw.adminMobile || null,
      adminFirstName: raw.adminFirstName || null,
      adminLastName: raw.adminLastName || null
    }).subscribe({
      next: (created) => {
        this.saving.set(false);
        const provisioning = created.provisioning;

        if (provisioning?.temporaryPassword) {
          this.dialog
            .open(TemporaryPasswordDialog, {
              // The only moment this password exists in readable form.
              disableClose: true,
              data: {
                subject: `Company admin for ${created.companyName}`,
                email: provisioning.adminEmail,
                password: provisioning.temporaryPassword,
                emailSent: provisioning.activationEmailSent,
                nextStep: 'The account is pending: the holder must follow the activation '
                  + 'link before this password will let them in.'
              }
            })
            .afterClosed()
            .subscribe(() => this.router.navigate(['/companies', created.id]));
        } else {
          this.notify.success('Company created.');
          this.router.navigate(['/companies', created.id]);
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.notify.error(this.errorMessage(err));
      }
    });
  }
}
