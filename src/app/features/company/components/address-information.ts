import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { CompanyProfile } from '@core/models/company.model';

/** Read-only registered-address block for the profile view. */
@Component({
  selector: 'app-address-information',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="addr">
      <mat-icon class="addr__pin">location_on</mat-icon>
      @if (hasAddress()) {
        <address class="addr__body">
          @if (company().addressLine1) { <span>{{ company().addressLine1 }}</span> }
          @if (company().addressLine2) { <span>{{ company().addressLine2 }}</span> }
          <span>{{ cityLine() }}</span>
          @if (company().country) { <span>{{ company().country }}</span> }
        </address>
      } @else {
        <p class="addr__empty">No address on record.</p>
      }
    </div>
  `,
  styles: [`
    .addr { display:flex; gap:12px; align-items:flex-start; }
    .addr__pin { color:var(--content-muted); }
    .addr__body { font-style:normal; display:flex; flex-direction:column; gap:4px;
      font:500 17px var(--font-sans); color:var(--content-fg); }
    .addr__empty { font:400 17px var(--font-sans); color:var(--content-muted); margin:0; }
  `]
})
export class AddressInformation {
  readonly company = input.required<CompanyProfile>();

  protected readonly hasAddress = computed(() => {
    const c = this.company();
    return !!(c.addressLine1 || c.addressLine2 || c.city || c.state || c.postalCode || c.country);
  });

  protected readonly cityLine = computed(() => {
    const c = this.company();
    const city = [c.city, c.state].filter(Boolean).join(', ');
    return [city, c.postalCode].filter(Boolean).join(' — ');
  });
}
