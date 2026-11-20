import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { CompanyProfile } from '@core/models/company.model';

/** Read-only contact block for the profile view: email, mobile, telephone, website. */
@Component({
  selector: 'app-contact-information',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <dl class="kv">
      <div class="kv__row"><dt><mat-icon>mail</mat-icon>Email</dt><dd>{{ company().email || '—' }}</dd></div>
      <div class="kv__row"><dt><mat-icon>call</mat-icon>Mobile</dt><dd>{{ company().mobile || '—' }}</dd></div>
      <div class="kv__row"><dt><mat-icon>phone</mat-icon>Telephone</dt><dd>{{ company().alternateMobile || '—' }}</dd></div>
      <div class="kv__row">
        <dt><mat-icon>language</mat-icon>Website</dt>
        <dd>
          @if (company().website) {
            <a [href]="company().website" target="_blank" rel="noopener">{{ company().website }}</a>
          } @else { — }
        </dd>
      </div>
    </dl>
  `,
  styles: [`
    .kv { display:flex; flex-direction:column; gap:2px; margin:0; }
    .kv__row { display:flex; justify-content:space-between; gap:16px; padding:10px 0;
      border-bottom:1px solid var(--surface-border); }
    .kv__row:last-child { border-bottom:0; }
    dt { display:inline-flex; align-items:center; gap:8px; font:500 16px var(--font-sans); color:var(--content-muted); margin:0; }
    dt mat-icon { font-size:18px; width:18px; height:18px; color:var(--content-muted); }
    dd { font:600 16px var(--font-sans); color:var(--content-fg); margin:0; text-align:right; word-break:break-all; }
    dd a { color:var(--brand-600); text-decoration:none; }
    dd a:hover { text-decoration:underline; }
  `]
})
export class ContactInformation {
  readonly company = input.required<CompanyProfile>();
}
