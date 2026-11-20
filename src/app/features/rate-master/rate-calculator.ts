import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BreadcrumbService } from '@core/services/breadcrumb.service';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { RateCalculatorForm } from './components/rate-calculator-form';
import { PincodeRateCalculatorForm } from './components/pincode-rate-calculator-form';
import { FreightCalculatorForm } from '@features/freight-factor/components/freight-calculator-form';

type CalcTab = 'freight' | 'rate' | 'pincode';

/**
 * Rate Master's Calculator page — tabbed: this module's own Rate calculator, and the
 * Freight Factor calculator as a second tab (both self-contained, no host wiring). Was a
 * single Rate-only page; folded Freight Factor's Calculate card in here by direct
 * request instead of keeping two separate calculators in two separate places.
 */
@Component({
  selector: 'app-rate-calculator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, RateCalculatorForm, PincodeRateCalculatorForm, FreightCalculatorForm],
  template: `
    <div class="page">
      <header class="page__head">
        <div><h1 class="text-h1">Calculator</h1><p class="text-caption">Price a shipment without booking it.</p></div>
      </header>
      <app-card>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" class="tab" [class.tab--active]="activeTab() === 'freight'" (click)="activeTab.set('freight')">Freight Factor</button>
          <button type="button" role="tab" class="tab" [class.tab--active]="activeTab() === 'rate'" (click)="activeTab.set('rate')">Route Rate</button>
          <button type="button" role="tab" class="tab" [class.tab--active]="activeTab() === 'pincode'" (click)="activeTab.set('pincode')">Pincode to Pincode</button>
        </div>

        @if (activeTab() === 'freight') {
          <app-freight-calculator-form />
        } @else if (activeTab() === 'pincode') {
          <app-pincode-rate-calculator-form />
        } @else {
          <app-rate-calculator-form />
        }
      </app-card>
    </div>
  `,
  styles: [`
    .page { display:flex; flex-direction:column; gap:20px; }
    .page__head { display:flex; align-items:flex-start; justify-content:space-between; }
    .tabs { display:flex; gap:4px; border-bottom:1px solid var(--surface-border); margin-bottom:16px; }
    .tab { border:0; background:transparent; padding:10px 4px; margin-right:16px; font:600 16px var(--font-sans);
      color:var(--content-muted); cursor:pointer; border-bottom:2px solid transparent; }
    .tab--active { color:var(--brand-600); border-bottom-color:var(--brand-600); }
  `]
})
export class RateCalculator {
  private readonly breadcrumb = inject(BreadcrumbService);
  protected readonly activeTab = signal<CalcTab>('freight');
  constructor() { this.breadcrumb.set([{ label: 'Rate Master', route: '/rates' }, { label: 'Calculator' }]); }
}
