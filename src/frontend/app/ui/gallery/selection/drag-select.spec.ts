import {NgZone} from '@angular/core';
import {DragSelect} from './drag-select';
import {SelectionService} from './selection.service';

describe('DragSelect long press', () => {
  const zone = {run: (f: () => void) => f(), runOutsideAngular: (f: () => void) => f()} as unknown as NgZone;
  let selection: SelectionService;
  let dragSelect: DragSelect;
  let tile: HTMLElement;
  let img: HTMLElement;
  let canStart: boolean;

  const pointer = (type: string, pointerType = 'touch', x = 10, y = 10): PointerEvent => {
    const e = new PointerEvent(type, {
      bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, pointerType, clientX: x, clientY: y
    });
    img.dispatchEvent(e);
    return e;
  };

  beforeEach(() => {
    jasmine.clock().install();
    selection = new SelectionService();
    canStart = true;
    dragSelect = new DragSelect(selection, zone, () => canStart);
    dragSelect.attach();
    tile = document.createElement('div');
    tile.dataset['selection'] = 'm:dir/a.jpg';
    img = document.createElement('img');
    tile.appendChild(img);
    document.body.appendChild(tile);
  });

  afterEach(() => {
    dragSelect.detach();
    tile.remove();
    jasmine.clock().uninstall();
  });

  it('should start the selection mode with the pressed tile selected', () => {
    pointer('pointerdown');
    jasmine.clock().tick(499);
    expect(selection.active).toBeFalse();
    jasmine.clock().tick(1);
    expect(selection.active).toBeTrue();
    expect(selection.hasKey('m:dir/a.jpg')).toBeTrue();
    pointer('pointerup');
    // the tap that ends the long press does not unselect the tile
    expect(selection.justDragged).toBeTrue();
  });

  it('should start at once when the browser sees the long press first', () => {
    pointer('pointerdown');
    jasmine.clock().tick(300);
    const menu = new MouseEvent('contextmenu', {bubbles: true, cancelable: true});
    img.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBeTrue();
    expect(selection.hasKey('m:dir/a.jpg')).toBeTrue();
  });

  it('should not start on a short tap, a scroll or a mouse', () => {
    pointer('pointerdown');
    jasmine.clock().tick(200);
    pointer('pointerup');
    jasmine.clock().tick(1000);
    expect(selection.active).toBeFalse();

    pointer('pointerdown');
    pointer('pointermove', 'touch', 10, 30);
    jasmine.clock().tick(1000);
    expect(selection.active).toBeFalse();

    pointer('pointerdown', 'mouse');
    jasmine.clock().tick(1000);
    expect(selection.active).toBeFalse();
    const menu = new MouseEvent('contextmenu', {bubbles: true, cancelable: true});
    img.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBeFalse(); // right click: the browser's menu
  });

  it('should select up to the held finger after a long press, even vertically, without scrolling', () => {
    tile.style.cssText = 'position:fixed;left:0;top:0;width:50px;height:50px';
    const below = document.createElement('div');
    below.dataset['selection'] = 'm:dir/b.jpg';
    below.style.cssText = 'position:fixed;left:0;top:60px;width:50px;height:50px';
    document.body.appendChild(below);
    try {
      pointer('pointerdown');
      jasmine.clock().tick(500);
      expect(selection.active).toBeTrue();
      const touchMove = new Event('touchmove', {bubbles: true, cancelable: true});
      img.dispatchEvent(touchMove);
      expect(touchMove.defaultPrevented).toBeTrue();
      pointer('pointermove', 'touch', 12, 40);
      pointer('pointermove', 'touch', 12, 80);
      expect(selection.hasKey('m:dir/a.jpg')).toBeTrue();
      expect(selection.hasKey('m:dir/b.jpg')).toBeTrue();
      pointer('pointerup', 'touch', 12, 80);
      const later = new Event('touchmove', {bubbles: true, cancelable: true});
      img.dispatchEvent(later);
      expect(later.defaultPrevented).toBeFalse(); // finger lifted: scrolling again
    } finally {
      below.remove();
    }
  });

  it('should not start for a user who can not select', () => {
    canStart = false;
    pointer('pointerdown');
    jasmine.clock().tick(1000);
    expect(selection.active).toBeFalse();
  });
});
