import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NotificationService } from '@core/services/notification.service';
import { BusCrossingPick, BusDepotRef, ShipmentBusCrossing, depotRefLabel } from '@core/models/bus-depot.model';
import { UiCard } from '@shared/components/ui-card/ui-card';
import { UiButton } from '@shared/components/ui-button/ui-button';
import { DialogService } from '@shared/components/ui-dialog/dialog.service';
import { BusCrossingEditor } from './bus-crossing-editor';
import { BusDepotService } from './bus-depot.service';

/** Shipment detail panel: the MSRTC crossing this shipment travels, with add / change / remove for those who may edit. */
@Component({
  selector: 'app-shipment-bus-crossing-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiButton, BusCrossingEditor],
  template: `
    <app-card title="Crossing" subtitle="Bus changes on the way — depot / station to depot / station">
      @if (editing()) {
        <app-bus-crossing-editor [optional]="false" [fromBranchId]="fromBranchId()" [toBranchId]="toBranchId()" [initial]="current()" [(value)]="pick" />
        <div class="bar">
          <app-button variant="stroked" (pressed)="editing.set(false)">Cancel</app-button>
          <app-button icon="save" [loading]="saving()" [disabled]="!pick()" (pressed)="save()">Save</app-button>
        </div>
      } @else if (crossing(); as c) {
        <ol class="path">
          <li><b>{{ c.from.depotName }}</b><span class="sub">{{ label(c.from) }}</span></li>
          @for (s of c.stops; track s.id) {
            <li class="via"><b>{{ s.depotName }}</b><span class="sub">Crossing · {{ label(s) }}</span></li>
          }
          <li><b>{{ c.to.depotName }}</b><span class="sub">{{ label(c.to) }}</span></li>
        </ol>
        @if (canEdit()) {
          <div class="bar">
            <app-button variant="stroked" (pressed)="remove()">Remove</app-button>
            <app-button variant="stroked" icon="edit" (pressed)="editing.set(true)">Change</app-button>
          </div>
        }
      } @else if (loaded()) {
        <p class="empty">No crossing — this shipment goes on a direct bus.</p>
        @if (canEdit()) {
          <div class="bar"><app-button icon="add" (pressed)="editing.set(true)">Add crossing</app-button></div>
        }
      }
    </app-card>
  `,
  styles: [`
    .path { list-style:none; margin:0; padding:0 0 0 14px; border-left:2px solid var(--surface-border); display:flex; flex-direction:column; gap:12px; }
    .path li { display:flex; flex-direction:column; font:400 17px var(--font-sans); position:relative; }
    .path li::before { content:''; position:absolute; left:-20px; top:5px; width:10px; height:10px; border-radius:50%; background:var(--brand-600, #4f46e5); }
    .path li.via::before { background:var(--warning, #f59e0b); }
    .sub { font:400 15px var(--font-sans); color:var(--content-muted); }
    .empty { margin:0; font:400 17px var(--font-sans); color:var(--content-muted); }
    .bar { display:flex; justify-content:flex-end; gap:10px; margin-top:12px; }
  `]
})
export class ShipmentBusCrossingCard implements OnInit {
  private readonly service = inject(BusDepotService);
  private readonly notify = inject(NotificationService);
  private readonly confirm = inject(DialogService);

  readonly shipmentId = input.required<string>();
  readonly canEdit = input(false);
  /** The shipment's booking / delivery branches — saved crossings between them are suggested. */
  readonly fromBranchId = input<string | null>(null);
  readonly toBranchId = input<string | null>(null);

  protected readonly crossing = signal<ShipmentBusCrossing | null>(null);
  protected readonly loaded = signal(false);
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly pick = signal<BusCrossingPick | null>(null);

  protected current(): BusCrossingPick | null {
    const c = this.crossing();
    return c ? { fromDepotId: c.from.id, toDepotId: c.to.id, stops: c.stops.map((s) => s.id) } : null;
  }

  protected label(d: BusDepotRef): string { return depotRefLabel(d); }

  ngOnInit(): void {
    this.service.shipmentCrossing(this.shipmentId()).subscribe({
      next: (c) => { this.crossing.set(c ?? null); this.loaded.set(true); },
      error: () => this.loaded.set(true)
    });
  }

  protected save(): void {
    const body = this.pick();
    if (!body) return;
    this.saving.set(true);
    this.service.setShipmentCrossing(this.shipmentId(), { ...body, saveAsRoute: true }).subscribe({
      next: (c) => { this.saving.set(false); this.crossing.set(c); this.editing.set(false); this.notify.success('Crossing saved.'); },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.notify.error(e.error?.message ?? 'Could not save the crossing.'); }
    });
  }

  protected remove(): void {
    this.confirm.confirm({ title: 'Remove crossing?', message: 'This shipment will show no crossing. The saved route stays.', confirmLabel: 'Remove', danger: true })
      .subscribe((ok) => {
        if (!ok) return;
        this.service.clearShipmentCrossing(this.shipmentId()).subscribe({
          next: () => { this.crossing.set(null); this.notify.success('Crossing removed.'); },
          error: (e: HttpErrorResponse) => this.notify.error(e.error?.message ?? 'Could not remove the crossing.')
        });
      });
  }
}
