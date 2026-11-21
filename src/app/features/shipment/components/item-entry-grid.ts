import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ShipmentItemRequest } from '@core/models/shipment.model';

/** One editable row, kept as a plain object rather than a FormArray — the grid is small
 *  (a handful of packages per shipment) and the host only ever wants the finished list. */
export interface ItemRow {
  itemName: string;
  quantity: number;
  weight: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  declaredValue: number | null;
  fragile: boolean;
  dangerousGoods: boolean;
}

/** The default when the service type sets no divisor of its own. */
export const DEFAULT_VOLUMETRIC_DIVISOR = 5000;

/** A new row starts with no weight: the desk types the real weight, nothing is assumed. */
function emptyRow(): ItemRow {
  // itemName defaults to a real value, not '' — toRequests() below filters out any row
  // with a blank name (it can't book a nameless package), and an unedited default row
  // is exactly the "one implicit package" case CreateShipmentRequest's own docs describe.
  // An empty string here silently dropped every never-touched default row from the
  // request instead.
  return { itemName: 'Package', quantity: 1, weight: null, lengthCm: null, widthCm: null,
    heightCm: null, declaredValue: null, fragile: false, dangerousGoods: false };
}

/**
 * The packed item grid — one row per package, add/remove freely. Weight/volumetric/
 * chargeable shown here are a **client-side preview only**, using the same formula the
 * Pricing Engine's `VolumetricCalculator`/`ChargeableWeightCalculator` apply
 * (`volumetric = l*w*h/divisor * quantity`, the divisor being the chosen service type's own,
 * 5000 by default; `chargeable = max(actual, volumetric)`) — the
 * figures that actually book come back from the server in Step 3. `weight` itself is the
 * row's own total, entered directly — not multiplied by `quantity` the way L/W/H are.
 */
@Component({
  selector: 'app-item-entry-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule],
  template: `
    <div class="ieg">
      <div class="ieg__table">
        <div class="ieg__head">
          <span>Item</span><span>Qty</span><span>Weight (kg)</span><span>L (cm)</span>
          <span>W (cm)</span><span>H (cm)</span><span>Value</span><span></span>
        </div>
        @for (row of rows(); track $index) {
          <div class="ieg__row">
            <input class="ieg__i" placeholder="Package" [value]="row.itemName" (input)="patch($index, { itemName: input($event) })" />
            <input class="ieg__i ieg__i--n" type="number" min="1" [value]="row.quantity" (input)="patch($index, { quantity: num($event) || 1 })" />
            <input class="ieg__i ieg__i--n" type="number" step="0.001" min="0.001" [value]="row.weight"
                   (input)="patch($index, { weight: num($event) })" />
            <input class="ieg__i ieg__i--n" type="number" step="0.01" min="0.01" [value]="row.lengthCm" (input)="patch($index, { lengthCm: num($event) })" />
            <input class="ieg__i ieg__i--n" type="number" step="0.01" min="0.01" [value]="row.widthCm" (input)="patch($index, { widthCm: num($event) })" />
            <input class="ieg__i ieg__i--n" type="number" step="0.01" min="0.01" [value]="row.heightCm" (input)="patch($index, { heightCm: num($event) })" />
            <input class="ieg__i ieg__i--n" type="number" step="0.01" min="0" [value]="row.declaredValue" (input)="patch($index, { declaredValue: num($event) })" />
            <button type="button" class="ieg__del" (click)="remove($index)" [disabled]="rows().length === 1" aria-label="Remove item">
              <mat-icon>delete</mat-icon>
            </button>
          </div>
        }
      </div>

      <div class="ieg__toolbar">
        <button type="button" class="ieg__add" (click)="add()"><mat-icon>add</mat-icon> Add item</button>
        <div class="ieg__extra"><ng-content /></div>
      </div>

      <div class="ieg__summary">
        <span>Packages: <strong>{{ totalQuantity() }}</strong></span>
        <span>Actual Weight: <strong>{{ actualWeight() | number: '1.3-3' }} kg</strong></span>
        <span>Volumetric Weight (÷{{ volumetricDivisor() || 5000 }}): <strong>{{ volumetricWeight() | number: '1.3-3' }} kg</strong></span>
        <span class="ieg__summary-main">Chargeable Weight: <strong>{{ chargeableWeight() | number: '1.3-3' }} kg</strong></span>
      </div>
    </div>
  `,
  styles: [`
    .ieg { display:flex; flex-direction:column; gap:12px; }
    .ieg__table { border:1px solid var(--surface-border); border-radius:var(--r-field); overflow:auto; }
    .ieg__head, .ieg__row { display:grid; grid-template-columns:1.6fr .7fr 1fr 1fr 1fr 1fr 1fr 40px; gap:8px; align-items:center; padding:8px 10px; min-width:640px; }
    .ieg__head { background:var(--surface-muted); font:600 15px var(--font-sans); color:var(--content-muted); }
    .ieg__row { border-top:1px solid var(--surface-border); }
    .ieg__i { height:36px; padding:0 8px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:8px; font:400 16px var(--font-sans); color:var(--content-fg); width:100%; min-width:0; }
    .ieg__i--n { text-align:right; }
    .ieg__i:focus { outline:0; border-color:var(--brand-500); }
    .ieg__del { border:0; background:transparent; cursor:pointer; color:var(--content-muted); display:flex; padding:6px; border-radius:8px; }
    .ieg__del:hover:not(:disabled) { background:var(--danger-bg); color:var(--danger); }
    .ieg__del:disabled { opacity:.35; cursor:not-allowed; }
    .ieg__toolbar { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    .ieg__add { align-self:flex-start; display:inline-flex; align-items:center; gap:6px; height:36px; padding:0 14px;
      border:1px dashed var(--surface-border); border-radius:var(--r-field); background:transparent; color:var(--brand-600);
      font:600 16px var(--font-sans); cursor:pointer; }
    .ieg__add:hover { background:var(--brand-50); }
    .ieg__extra { display:flex; gap:16px; flex-wrap:wrap; }
    .ieg__extra:empty { display:none; }
    .ieg__summary { display:flex; gap:24px; flex-wrap:wrap; padding:12px 16px; background:var(--surface); border:1px solid var(--surface-border);
      border-radius:var(--r-field); font:400 16px var(--font-sans); color:var(--content-muted); }
    .ieg__summary strong { color:var(--content-fg); font-weight:700; }
    .ieg__summary-main strong { color:var(--brand-600); }
  `]
})
export class ItemEntryGrid {
  /** Prefill for edit mode. */
  readonly initial = input<ShipmentItemRequest[] | null>(null);
  /** The chosen service type's volumetric divisor (Air and Surface differ); empty = 5000. */
  readonly volumetricDivisor = input<number | null | undefined>(null);

  readonly itemsChange = output<ShipmentItemRequest[]>();
  readonly weightChange = output<{ actual: number; volumetric: number; chargeable: number }>();
  readonly packagesChange = output<number>();

  protected readonly rows = signal<ItemRow[]>([emptyRow()]);

  /** Number of Packages is not typed in — it's the sum of every row's quantity,
   *  so the header field is a display of this grid rather than a second source of truth. */
  protected readonly totalQuantity = computed(() =>
    this.rows().reduce((sum, r) => sum + (r.quantity || 1), 0));

  // Weight (kg) is the row's own total, not a per-unit figure — unlike the L/W/H fields
  // below, it is never multiplied by quantity.
  protected readonly actualWeight = computed(() =>
    this.rows().reduce((sum, r) => sum + (r.weight ?? 0), 0));

  protected readonly volumetricWeight = computed(() =>
    this.rows().reduce((sum, r) => {
      if (!r.lengthCm || !r.widthCm || !r.heightCm) return sum;
      const v = (r.lengthCm * r.widthCm * r.heightCm) / (this.volumetricDivisor() || DEFAULT_VOLUMETRIC_DIVISOR);
      return sum + v * (r.quantity || 1);
    }, 0));

  // Whichever is higher, actual or volumetric (L×W×H) — the backend prices the same way,
  // with no company-wide minimum.
  protected readonly chargeableWeight = computed(() => Math.max(this.actualWeight(), this.volumetricWeight()));

  constructor() {
    effect(() => {
      const initial = this.initial();
      if (initial?.length) {
        this.rows.set(initial.map((i) => ({
          itemName: i.itemName, quantity: i.quantity ?? 1, weight: i.weight,
          lengthCm: i.lengthCm ?? null, widthCm: i.widthCm ?? null, heightCm: i.heightCm ?? null,
          declaredValue: i.declaredValue ?? null, fragile: !!i.fragile, dangerousGoods: !!i.dangerousGoods
        })));
      }
    });

    effect(() => { this.itemsChange.emit(this.toRequests()); });
    effect(() => { this.packagesChange.emit(this.totalQuantity()); });
    effect(() => {
      this.weightChange.emit({
        actual: round3(this.actualWeight()), volumetric: round3(this.volumetricWeight()),
        chargeable: round3(this.chargeableWeight())
      });
    });
  }

  protected input(e: Event): string { return (e.target as HTMLInputElement).value; }
  protected num(e: Event): number | null {
    const v = (e.target as HTMLInputElement).value;
    return v === '' ? null : Number(v);
  }

  protected patch(index: number, changes: Partial<ItemRow>): void {
    const next = this.rows().slice();
    next[index] = { ...next[index], ...changes };
    this.rows.set(next);
  }

  protected add(): void {
    this.rows.set([...this.rows(), emptyRow()]);
  }
  protected remove(index: number): void {
    if (this.rows().length === 1) return;
    this.rows.set(this.rows().filter((_, i) => i !== index));
  }

  private toRequests(): ShipmentItemRequest[] {
    return this.rows()
      .filter((r) => r.itemName.trim() && r.weight != null && r.weight > 0)
      .map((r) => ({
        itemName: r.itemName.trim(), quantity: r.quantity || 1, weight: r.weight as number,
        lengthCm: r.lengthCm, widthCm: r.widthCm, heightCm: r.heightCm,
        declaredValue: r.declaredValue, fragile: r.fragile, dangerousGoods: r.dangerousGoods
      }));
  }
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }
