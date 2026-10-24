import {NgZone} from '@angular/core';
import {SelectionService} from './selection.service';

/**
 * Selection by dragging (like Photos on iPhone): in the selection mode, start dragging
 * HORIZONTALLY from a tile, then in any direction: every tile between the first one and the one
 * under the finger (in page order) takes the opposite state of the first one; going back gives
 * the tiles leaving the range their previous state. A gesture that starts vertically scrolls
 * (touch-action: pan-y). Near the top/bottom of the screen the page scrolls by itself.
 * Tiles are found by their data-selection attribute (see SelectionService.mediaKey/directoryKey).
 */
export class DragSelect {
  private static readonly SELECTOR = '[data-selection]';
  private start: { x: number, y: number, key: string, pointerId: number } = null;
  private dragging = false;
  private target = false;
  private before: Set<string> = null;
  private last: { x: number, y: number } = null;
  private readonly listeners: [string, (e: Event) => void][] = [];

  constructor(private selection: SelectionService, private zone: NgZone) {
  }

  public attach(): void {
    this.zone.runOutsideAngular(() => {
      this.listen('pointerdown', (e: PointerEvent) => this.onDown(e));
      this.listen('pointermove', (e: PointerEvent) => this.onMove(e));
      this.listen('pointerup', () => this.end());
      this.listen('pointercancel', () => this.end());
      this.listen('dragstart', (e: Event) => {
        if (this.selection.active) {
          e.preventDefault();
        }
      });
      this.listen('contextmenu', (e: Event) => {
        if (this.selection.active && DragSelect.tile(e.target as Element)) {
          e.preventDefault(); // no long-press menu on the tiles
        }
      });
    });
  }

  public detach(): void {
    this.listeners.forEach(([type, fn]) => document.removeEventListener(type, fn, true));
    this.listeners.length = 0;
  }

  private listen(type: string, fn: (e: Event) => void): void {
    document.addEventListener(type, fn, {capture: true, passive: false} as AddEventListenerOptions);
    this.listeners.push([type, fn]);
  }

  private static tile(el: Element): HTMLElement {
    return (el?.closest?.(DragSelect.SELECTOR) as HTMLElement) || null;
  }

  private static under(x: number, y: number): HTMLElement {
    for (const e of document.elementsFromPoint(x, y)) { // possibly under the bar
      const t = DragSelect.tile(e);
      if (t) {
        return t;
      }
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    if (!this.selection.active || !e.isPrimary || e.button > 0) {
      return;
    }
    const t = DragSelect.tile(e.target as Element);
    this.start = t ? {x: e.clientX, y: e.clientY, key: t.dataset['selection'], pointerId: e.pointerId} : null;
    this.dragging = false;
  }

  private onMove(e: PointerEvent): void {
    if (!this.start || e.pointerId !== this.start.pointerId) {
      return;
    }
    if (!this.dragging) {
      const dx = Math.abs(e.clientX - this.start.x);
      const dy = Math.abs(e.clientY - this.start.y);
      if (dx < 10 && dy < 10) {
        return;
      }
      if (dy > dx && e.pointerType !== 'mouse') {
        this.start = null; // scrolling
        return;
      }
      this.dragging = true;
      this.before = new Set([
        ...[...this.selection.media.keys()].map(p => 'm:' + p),
        ...[...this.selection.directories].map(p => 'd:' + p),
      ]);
      this.target = !this.selection.hasKey(this.start.key);
      try {
        document.documentElement.setPointerCapture(e.pointerId);
      } catch (err) {
        // not supported: fine
      }
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }
      requestAnimationFrame(() => this.autoScroll());
    }
    e.preventDefault();
    this.last = {x: e.clientX, y: e.clientY};
    this.range(DragSelect.under(e.clientX, e.clientY));
  }

  private range(current: HTMLElement): void {
    if (!current) {
      return;
    }
    const all = Array.from(document.querySelectorAll<HTMLElement>(DragSelect.SELECTOR));
    const i0 = all.findIndex(t => t.dataset['selection'] === this.start.key);
    const i1 = all.indexOf(current);
    if (i0 < 0 || i1 < 0) {
      return;
    }
    const [a, b] = i0 < i1 ? [i0, i1] : [i1, i0];
    this.zone.run(() => {
      all.forEach((t, i) => {
        const key = t.dataset['selection'];
        this.selection.setKey(key, i >= a && i <= b ? this.target : this.before.has(key));
      });
    });
  }

  private autoScroll(): void {
    if (!this.dragging || !this.last) {
      return;
    }
    const y = this.last.y;
    const h = window.innerHeight;
    const step = y > h - 70 ? Math.min(25, (y - (h - 70)) / 2 + 6) : y < 70 ? -Math.min(25, (70 - y) / 2 + 6) : 0;
    if (step) {
      window.scrollBy(0, step);
      this.range(DragSelect.under(this.last.x, this.last.y));
    }
    requestAnimationFrame(() => this.autoScroll());
  }

  private end(): void {
    if (this.dragging) {
      this.selection.dragEndedAt = Date.now();
    }
    this.start = null;
    this.dragging = false;
    this.last = null;
  }
}
