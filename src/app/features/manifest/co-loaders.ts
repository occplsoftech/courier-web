import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { NotificationService } from '@core/services/notification.service';
import { CoLoader } from '@core/models/shipment.model';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { CoLoaderService } from './co-loader.service';

/**
 * Masters → Co-Loaders: outside transporters / agents a branch hands parcels to at outscan (Scan → Assign to Branch)
 * or for local delivery (Assign to Delivery), as on the earlier OCCPL portal.
 */
@Component({
  selector: 'app-co-loaders',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, UiButton],
  template: `
    <div class="cl">
      <header class="page__head"><div><h1 class="text-h1">Co-Loaders</h1>
        <p class="text-caption">Outside transporters and agents used at outscan and for local delivery (Scan → Assign).</p></div></header>

      <section class="card form" aria-label="Add or edit a co-loader">
        <h2 class="sec">{{ editing() ? 'Edit co-loader' : 'Add a co-loader' }}</h2>
        <div class="g">
          <label class="f"><span class="f__l">Name <b class="req">*</b></span><input class="in" id="cl-name" maxlength="150" [value]="name()" (input)="name.set($any($event.target).value)" placeholder="e.g. SELF VEHICLE, NIGHT BIRD" /></label>
          <label class="f"><span class="f__l">Contact person</span><input class="in" maxlength="150" [value]="contact()" (input)="contact.set($any($event.target).value)" /></label>
          <label class="f"><span class="f__l">Phone</span><input class="in" maxlength="20" inputmode="tel" [value]="phone()" (input)="phone.set($any($event.target).value)" /></label>
          <label class="f"><span class="f__l">Notes</span><input class="in" maxlength="500" [value]="notes()" (input)="notes.set($any($event.target).value)" /></label>
        </div>
        <div class="acts">
          @if (editing()) { <button type="button" class="pill" (click)="reset()">Cancel</button> }
          <app-button [icon]="editing() ? 'save' : 'add'" [loading]="busy()" (pressed)="save()">{{ editing() ? 'Save' : 'Add co-loader' }}</app-button>
        </div>
      </section>

      <section class="card">
        @if (!rows().length) { <p class="muted">No co-loaders yet. Add the transporters and agents your branches hand parcels to.</p> }
        @else {
          <table class="t"><thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Notes</th><th>Status</th><th></th></tr></thead>
            <tbody>@for (c of rows(); track c.id) {
              <tr [class.off]="!c.active"><td><b>{{ c.name }}</b></td><td>{{ c.contactPerson || '—' }}</td><td>{{ c.phone || '—' }}</td><td>{{ c.notes || '—' }}</td>
                <td><span class="st" [class.st--off]="!c.active">{{ c.active ? 'Active' : 'Off' }}</span></td>
                <td class="r"><button type="button" class="ico" (click)="edit(c)" [attr.aria-label]="'Edit ' + c.name"><mat-icon>edit</mat-icon></button>
                  <button type="button" class="pill" (click)="toggle(c)">{{ c.active ? 'Switch off' : 'Switch on' }}</button></td></tr>
            }</tbody></table>
        }
      </section>
    </div>
  `,
  styles: [`
    .cl { display: flex; flex-direction: column; gap: 16px; }
    .card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: var(--r-card); padding: 20px; box-shadow: var(--shadow-clay-sm); }
    .sec { font: 600 18px var(--font-sans); margin: 0 0 12px; }
    .g { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .f { display: flex; flex-direction: column; gap: 6px; } .f__l { font: 500 14px var(--font-sans); color: var(--content-muted); } .req { color: var(--danger); }
    .in { height: 44px; padding: 0 12px; border: 1px solid var(--surface-border); border-radius: var(--r-field); background: var(--surface); color: var(--content-fg); font: 400 16px var(--font-sans); }
    .acts { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
    .pill { border: 1px solid var(--surface-border); background: var(--surface); color: var(--content-fg); border-radius: 999px; padding: 7px 14px; font: 600 14px var(--font-sans); cursor: pointer; }
    .ico { border: 0; background: none; cursor: pointer; color: var(--content-muted); }
    .t { width: 100%; border-collapse: collapse; } .t th, .t td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--surface-border); font: 400 15px var(--font-sans); }
    .t th { color: var(--content-muted); font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; } .r { text-align: right; white-space: nowrap; }
    .off td { color: var(--content-muted); } .st { padding: 2px 10px; border-radius: 999px; background: var(--success-bg); color: var(--success); font: 600 13px var(--font-sans); }
    .st--off { background: var(--surface-muted); color: var(--content-muted); } .muted { color: var(--content-muted); margin: 0; }
    @media (max-width: 900px) { .g { grid-template-columns: 1fr; } .t { display: block; overflow-x: auto; } }
  `]
})
export class CoLoaders {
  private readonly service = inject(CoLoaderService);
  private readonly notify = inject(NotificationService);

  protected readonly rows = signal<CoLoader[]>([]);
  protected readonly editing = signal<CoLoader | null>(null);
  protected readonly busy = signal(false);
  protected readonly name = signal('');
  protected readonly contact = signal('');
  protected readonly phone = signal('');
  protected readonly notes = signal('');

  constructor() {
    inject(BreadcrumbService).set([{ label: 'Masters' }, { label: 'Co-Loaders' }]);
    this.load();
  }

  private load(): void {
    this.service.list(true).subscribe({ next: (r) => this.rows.set(r), error: () => this.notify.error('Could not load the co-loaders.') });
  }

  protected edit(c: CoLoader): void {
    this.editing.set(c);
    this.name.set(c.name); this.contact.set(c.contactPerson ?? ''); this.phone.set(c.phone ?? ''); this.notes.set(c.notes ?? '');
    setTimeout(() => document.getElementById('cl-name')?.focus());
  }

  protected reset(): void {
    this.editing.set(null);
    this.name.set(''); this.contact.set(''); this.phone.set(''); this.notes.set('');
  }

  protected save(): void {
    if (!this.name().trim()) { this.notify.error('Enter the name of the co-loader.'); return; }
    const body = { name: this.name().trim(), contactPerson: this.contact().trim(), phone: this.phone().trim(), notes: this.notes().trim() };
    const e = this.editing();
    this.busy.set(true);
    (e ? this.service.update(e.id, body) : this.service.create(body)).subscribe({
      next: () => { this.busy.set(false); this.notify.success(e ? 'Co-loader saved.' : 'Co-loader added.'); this.reset(); this.load(); },
      error: (err: HttpErrorResponse) => { this.busy.set(false); this.notify.error(err.error?.message ?? 'Could not save the co-loader.'); }
    });
  }

  protected toggle(c: CoLoader): void {
    this.service.update(c.id, { active: !c.active }).subscribe({
      next: () => this.load(),
      error: (err: HttpErrorResponse) => this.notify.error(err.error?.message ?? 'Could not change the co-loader.')
    });
  }
}
