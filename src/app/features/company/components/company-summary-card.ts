import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { StatusBadge } from '@shared/components/status-badge/status-badge';
import { CompanyProfile } from '@core/models/company.model';

/** Identity banner at the top of the profile: mark, name/code, status and headline facts. */
@Component({
  selector: 'app-company-summary-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, StatusBadge],
  template: `
    <section class="app-card sum">
      <figure class="sum__mark">
        @if (company().logo) {
          <img [src]="company().logo" [alt]="company().companyName" />
        } @else {
          <span class="sum__initials">{{ initials() }}</span>
        }
      </figure>

      <div class="sum__id">
        <div class="sum__name-row">
          <h2 class="sum__name">{{ company().companyName }}</h2>
          <app-status-badge [value]="company().status" />
          @if (company().isActive) {
            <app-status-badge label="Active" tone="success" />
          } @else {
            <app-status-badge label="Inactive" tone="neutral" />
          }
        </div>
        @if (company().legalName) { <p class="sum__legal">{{ company().legalName }}</p> }
        <div class="sum__facts">
          <span class="fact"><mat-icon>tag</mat-icon>{{ company().companyCode }}</span>
          @if (company().email) { <span class="fact"><mat-icon>mail</mat-icon>{{ company().email }}</span> }
          @if (company().mobile) { <span class="fact"><mat-icon>call</mat-icon>{{ company().mobile }}</span> }
          @if (location()) { <span class="fact"><mat-icon>location_on</mat-icon>{{ location() }}</span> }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .sum { display:flex; gap:20px; align-items:center; padding:20px 24px; }
    .sum__mark { width:80px; height:80px; flex:none; border-radius:16px; overflow:hidden;
      display:grid; place-items:center; background:var(--brand-50, var(--surface-muted));
      border:1px solid var(--surface-border); }
    .sum__mark img { width:100%; height:100%; object-fit:contain; }
    .sum__initials { font:700 29px var(--font-sans); color:var(--brand-600); }
    .sum__id { min-width:0; }
    .sum__name-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .sum__name { font:700 25px var(--font-sans); color:var(--content-fg); margin:0; }
    .sum__legal { font:400 17px var(--font-sans); color:var(--content-muted); margin:4px 0 0; }
    .sum__facts { display:flex; gap:18px; flex-wrap:wrap; margin-top:12px; }
    .fact { display:inline-flex; align-items:center; gap:6px; font:500 16px var(--font-sans); color:var(--content-muted); }
    .fact mat-icon { font-size:16px; width:16px; height:16px; color:var(--content-muted); }
    @media (max-width:640px){ .sum{ flex-direction:column; align-items:flex-start; } }
  `]
})
export class CompanySummaryCard {
  readonly company = input.required<CompanyProfile>();

  initials(): string {
    return this.company().companyName.split(/\s+/).filter(Boolean).slice(0, 2)
      .map((w) => w[0]!.toUpperCase()).join('') || 'CO';
  }

  location(): string {
    const c = this.company();
    return [c.city, c.state, c.country].filter(Boolean).join(', ');
  }
}
