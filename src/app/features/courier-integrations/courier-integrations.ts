import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiInput } from '@shared/components/ui-input/ui-input';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { apiMessage } from '@features/communication/api-error';
import { CourierIntegration, CourierIntegrationService } from './courier-integration.service';

interface Card {
  info: CourierIntegration;
  form: FormGroup;
}

/**
 * The company's own accounts with external couriers, used by the customer shipping portal for rates, booking, tracking
 * and labels. One card per courier; the fields come from the server, so a courier added there appears here with no change.
 * Secrets are write-only: a saved one shows as "Configured" and a blank field keeps it.
 */
@Component({
  selector: 'app-courier-integrations',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatSlideToggleModule, DatePipe, UiCard, UiInput, UiButton],
  template: `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="text-h1">Courier Integrations</h1>
          <p class="text-caption">
            Connect your own courier accounts. Your customers see these couriers' real rates in the shipping portal.
            Passwords and tokens are stored encrypted and are never shown again.
          </p>
        </div>
      </header>

      @if (error()) { <p class="alert" role="alert">{{ error() }} <app-button variant="stroked" (pressed)="load()">Retry</app-button></p> }

      <section class="cards">
        @for (card of cards(); track card.info.code) {
          <app-card [title]="card.info.name">
            <div class="ci">
              <div class="ci__status">
                <span class="badge" [class.badge--ok]="card.info.connected" [class.badge--off]="!card.info.connected">
                  {{ !card.info.available ? 'Coming soon' : card.info.connected ? 'Connected' : 'Not connected' }}
                </span>
                @if (card.info.source === 'ENVIRONMENT') {
                  <span class="text-caption">Using the server's built-in account. Save your own details to use your own.</span>
                }
              </div>

              @if (card.info.available) {
                <div class="logo">
                  <span class="logo__box">
                    @if (card.info.logoDataUrl) { <img [src]="card.info.logoDataUrl" [alt]="card.info.name + ' logo'" /> }
                    @else { <span class="logo__none" aria-hidden="true">{{ card.info.name.slice(0, 2).toUpperCase() }}</span> }
                  </span>
                  <div class="logo__text">
                    <strong>Logo</strong>
                    <span class="hint">Shown to your customers next to {{ card.info.name }}. PNG, JPEG or WebP, up to 150 KB.</span>
                    <div class="logo__actions">
                      <app-button type="button" variant="stroked" icon="upload" [loading]="busy().has(card.info.code + ':logo')"
                        (pressed)="picker.click()">{{ card.info.logoDataUrl ? 'Replace logo' : 'Upload logo' }}</app-button>
                      @if (card.info.logoDataUrl) {
                        <app-button type="button" variant="stroked" (pressed)="removeLogo(card)">Remove</app-button>
                      }
                      <input #picker type="file" hidden accept="image/png,image/jpeg,image/webp"
                        (change)="onLogo(card, $event)" [attr.aria-label]="'Choose the ' + card.info.name + ' logo'" />
                    </div>
                  </div>
                </div>
              }

              @if (!card.info.available) {
                <p class="text-caption">{{ card.info.note }}</p>
              } @else {
                @if (card.info.credentialsUnreadable) {
                  <p class="alert" role="alert">The saved password or token can no longer be read. Please enter it again and save.</p>
                }
                <p class="text-caption">{{ card.info.note }}</p>
                <form [formGroup]="card.form" (ngSubmit)="save(card)" class="ci__form">
                  <label class="flag"><mat-slide-toggle [formControl]="ctl(card, 'enabled')" />
                    <span><strong>Enabled</strong><em>Offer this courier to your customers</em></span></label>

                  @for (f of card.info.fields; track f.key) {
                    <div class="ci__field">
                      <app-input [control]="ctl(card, f.key)" [label]="f.label + (f.required ? ' *' : '')"
                        [type]="f.secret ? 'password' : 'text'" [autocomplete]="f.secret ? 'new-password' : 'off'"
                        [maxLength]="200"
                        [placeholder]="f.secret ? (f.set ? 'Configured — leave blank to keep it' : 'Not set') : ''" />
                      @if (f.help) { <span class="hint">{{ f.help }}</span> }
                    </div>
                  }

                  <div class="ci__result" aria-live="polite">
                    @if (card.info.lastTestedAt) {
                      <span [class.ok]="card.info.lastTestOk" [class.bad]="!card.info.lastTestOk">
                        {{ card.info.lastTestMessage }}
                      </span>
                      <span class="text-caption">Tested {{ card.info.lastTestedAt | date: 'medium' }}</span>
                    }
                  </div>

                  <div class="ci__actions">
                    @if (card.info.source === 'COMPANY') {
                      <app-button type="button" variant="stroked" (pressed)="disconnect(card)">Disconnect</app-button>
                    }
                    <app-button type="button" variant="stroked" [loading]="busy().has(card.info.code + ':test')"
                      [disabled]="!card.info.enabled || card.form.dirty" (pressed)="test(card)">Test connection</app-button>
                    <app-button type="submit" icon="save" [loading]="busy().has(card.info.code + ':save')">Save</app-button>
                  </div>
                  @if (!card.info.enabled) {
                    <span class="hint">Turn this courier on, fill in its details and save — then you can test the connection.</span>
                  } @else if (card.form.dirty) {
                    <span class="hint">Save your changes to test them.</span>
                  }
                </form>

                <div class="hook">
                  <strong>Status updates</strong>
                  @if (card.info.statusPush === false) {
                    <span class="hint">Shipment statuses are checked with {{ card.info.name }} every hour. {{ card.info.name }} has no
                      webhook for instant updates.</span>
                  } @else if (card.info.webhookUrl; as url) {
                    <span class="hint">Shipment statuses are checked with {{ card.info.name }} every hour. For instant updates, paste
                      this address in {{ card.info.name }}'s panel ({{ hookWhere(card.info.code) }}).</span>
                    <div class="hook__row">
                      <code class="hook__url">{{ url }}</code>
                      <app-button type="button" variant="stroked" icon="content_copy" (pressed)="copy(url)">Copy</app-button>
                    </div>
                    <span class="hint">Keep it private: anyone with this address can send status updates for your shipments.</span>
                  } @else {
                    <span class="hint">Save this courier to get its webhook address for instant status updates.</span>
                  }
                </div>
              }
            </div>
          </app-card>
        }
      </section>
    </div>
  `,
  styles: [`
    .cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(340px, 1fr)); gap:20px; }
    .ci { display:flex; flex-direction:column; gap:12px; }
    .ci__status { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .badge { padding:2px 10px; border-radius:999px; font:600 12px var(--font-sans); background:var(--surface-muted); color:var(--content-muted); }
    .badge--ok { background:color-mix(in srgb, var(--success) 15%, transparent); color:var(--success); }
    .logo { display:flex; gap:14px; align-items:center; padding:12px; border:1px dashed var(--surface-border); border-radius:12px; }
    .logo__box { display:grid; place-items:center; flex:none; width:64px; height:64px; border-radius:12px; background:#fff; border:1px solid var(--surface-border); overflow:hidden; }
    .logo__box img { max-width:85%; max-height:85%; object-fit:contain; }
    .logo__none { font:700 18px var(--font-sans); color:var(--content-muted); }
    .logo__text { display:flex; flex-direction:column; gap:4px; min-width:0; }
    .logo__actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; }
    .ci__form { display:flex; flex-direction:column; gap:14px; }
    .ci__field { display:flex; flex-direction:column; gap:4px; }
    .hint { font:400 12px var(--font-sans); color:var(--content-muted); }
    .flag { display:flex; align-items:center; gap:12px; }
    .flag span { display:flex; flex-direction:column; }
    .flag em { font-style:normal; font-size:12px; color:var(--content-muted); }
    .ci__result { min-height:18px; display:flex; flex-direction:column; font:500 12px var(--font-sans); }
    .ci__result .ok { color:var(--success); }
    .ci__result .bad { color:var(--danger); }
    .ci__actions { display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }
    .hook { display:flex; flex-direction:column; gap:6px; padding-top:12px; border-top:1px solid var(--surface-border); }
    .hook__row { display:flex; gap:8px; align-items:center; }
    .hook__url { flex:1; min-width:0; overflow-wrap:anywhere; padding:8px 10px; border-radius:8px; background:var(--surface-muted);
      font:500 12px ui-monospace, SFMono-Regular, Menlo, monospace; user-select:all; }
    .alert { padding:10px 12px; border-radius:8px; background:color-mix(in srgb, var(--danger) 10%, transparent); color:var(--danger); font:500 13px var(--font-sans); }
  `]
})
export class CourierIntegrations implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(CourierIntegrationService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly notify = inject(NotificationService);
  private readonly dialogs = inject(DialogService);

  readonly cards = signal<Card[]>([]);
  readonly busy = signal<Set<string>>(new Set());
  readonly error = signal<string | null>(null);

  /** Where each courier's panel takes a webhook address. */
  hookWhere(code: string): string {
    return code === 'SHIPROCKET' ? 'Settings → API → Webhooks'
      : code === 'DELHIVERY' ? 'ask your Delhivery account manager to enable status push to it'
      : 'webhook settings';
  }

  copy(url: string): void {
    const done = () => this.notify.success('Webhook address copied.');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => this.notify.error('Copy failed. Select the address and copy it by hand.'));
    } else {
      this.notify.error('Copy is not available here. Select the address and copy it by hand.');
    }
  }

  ngOnInit(): void {
    this.breadcrumb.set([{ label: 'Administration' }, { label: 'Courier Integrations' }]);
    this.load();
  }

  load(): void {
    this.error.set(null);
    this.service.list().subscribe({
      next: (rows) => this.cards.set(rows.map((r) => this.toCard(r))),
      error: (e) => this.error.set(apiMessage(e, 'Could not load the courier integrations.'))
    });
  }

  ctl(card: Card, name: string): FormControl {
    return card.form.get(name) as FormControl;
  }

  /** Plain fields are filled with what is saved; secret fields always start empty. */
  private toCard(info: CourierIntegration): Card {
    const controls: Record<string, unknown[]> = { enabled: [info.enabled] };
    for (const f of info.fields) controls[f.key] = [f.secret ? '' : (f.value ?? '')];
    return { info, form: this.fb.group(controls) };
  }

  private replace(updated: CourierIntegration): void {
    this.cards.update((cards) => cards.map((c) => (c.info.code === updated.code ? this.toCard(updated) : c)));
  }

  private mark(key: string, on: boolean): void {
    this.busy.update((s) => { const n = new Set(s); on ? n.add(key) : n.delete(key); return n; });
  }

  save(card: Card): void {
    const v = card.form.getRawValue();
    const values: Record<string, string> = {};
    for (const f of card.info.fields) {
      const typed = String(v[f.key] ?? '').trim();
      if (typed) values[f.key] = typed;
    }
    const key = card.info.code + ':save';
    this.mark(key, true);
    this.service.save(card.info.code, { enabled: !!v['enabled'], values }).subscribe({
      next: (saved) => {
        this.mark(key, false);
        this.replace(saved);
        this.notify.success(`${saved.name} saved.`);
      },
      error: (e) => {
        this.mark(key, false);
        this.notify.error(apiMessage(e, `Could not save ${card.info.name}.`));
      }
    });
  }

  test(card: Card): void {
    const key = card.info.code + ':test';
    this.mark(key, true);
    this.service.test(card.info.code).subscribe({
      next: (tested) => { this.mark(key, false); this.replace(tested); },
      error: (e) => {
        this.mark(key, false);
        this.notify.error(apiMessage(e, `Could not test ${card.info.name}.`));
      }
    });
  }

  onLogo(card: Card, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 150 * 1024) { this.notify.error('The logo is larger than 150 KB. Use a smaller image.'); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { this.notify.error('The logo must be a PNG, JPEG or WebP image.'); return; }
    const key = card.info.code + ':logo';
    this.mark(key, true);
    this.service.uploadLogo(card.info.code, file).subscribe({
      next: () => { this.mark(key, false); this.notify.success(`${card.info.name} logo saved.`); this.reloadKeepingEdits(); },
      error: (e) => { this.mark(key, false); this.notify.error(apiMessage(e, `Could not save the ${card.info.name} logo.`)); }
    });
  }

  removeLogo(card: Card): void {
    this.service.removeLogo(card.info.code).subscribe({
      next: () => { this.notify.success(`${card.info.name} logo removed.`); this.reloadKeepingEdits(); },
      error: (e) => this.notify.error(apiMessage(e, `Could not remove the ${card.info.name} logo.`))
    });
  }

  /** Reloads the list but leaves each card's form alone, so typed-but-unsaved details survive a logo change. */
  private reloadKeepingEdits(): void {
    this.service.list().subscribe({
      next: (rows) => this.cards.update((cards) => cards.map((c) => {
        const fresh = rows.find((r) => r.code === c.info.code);
        return fresh ? { info: fresh, form: c.form } : c;
      })),
      error: (e) => this.error.set(apiMessage(e, 'Could not load the courier integrations.'))
    });
  }

  disconnect(card: Card): void {
    this.dialogs.confirm({
      title: `Disconnect ${card.info.name}?`,
      message: 'The saved details are removed and this courier is switched off for your customers. '
        + 'The server\'s built-in account (if any) is not used afterwards. Past bookings are unaffected.',
      confirmLabel: 'Disconnect', danger: true
    }).subscribe((ok) => {
      if (!ok) return;
      this.service.disconnect(card.info.code).subscribe({
        next: (done) => { this.replace(done); this.notify.success(`${done.name} disconnected.`); },
        error: (e) => this.notify.error(apiMessage(e, `Could not disconnect ${card.info.name}.`))
      });
    });
  }
}
