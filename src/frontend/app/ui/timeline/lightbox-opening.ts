/**
 * Opening a photo from the timeline: the lightbox lives on a search page,
 * which has to load first (a request to the server), and showed its grid
 * meanwhile. Instead, the touched tile grows at once to full screen on
 * black, above every page, and stays until the lightbox shows the photo at
 * the same place.
 * Plain DOM on <body>: it outlives the timeline leaving and the search page
 * coming.
 */
export class LightboxOpening {
  private static layer: HTMLElement = null;
  private static timer: number = null;
  private static growing: Animation = null;

  /**
   * @param tile the touched tile (its image is shown)
   * @param width,height size of the media, upright
   */
  public static show(tile: HTMLElement, width: number, height: number): void {
    this.hide();
    const img = tile.querySelector('img');
    const from = tile.getBoundingClientRect();
    const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
    const to = {
      width: width * scale,
      height: height * scale,
      left: (window.innerWidth - width * scale) / 2,
      top: (window.innerHeight - height * scale) / 2,
    };
    const layer = document.createElement('div');
    // opaque at once: the pages changing below are never seen
    layer.style.cssText = 'position:fixed;inset:0;z-index:1200;pointer-events:none;background:black';
    if (img?.currentSrc || img?.src) {
      const photo = document.createElement('img');
      photo.src = img.currentSrc || img.src;
      photo.style.cssText = `position:absolute;transform-origin:0 0;top:${to.top}px;left:${to.left}px;` +
        `width:${to.width}px;height:${to.height}px`;
      layer.appendChild(photo);
      // A transform runs on the compositor: it plays while the page is busy
      // building the search page (top/left/width stood still meanwhile).
      // The photo starts covering the tile, centred on it.
      const s0 = Math.max(from.width / to.width, from.height / to.height);
      const x0 = from.left + (from.width - to.width * s0) / 2 - to.left;
      const y0 = from.top + (from.height - to.height * s0) / 2 - to.top;
      this.growing = photo.animate([
        {transform: `translate(${x0}px, ${y0}px) scale(${s0})`},
        {transform: 'none'},
      ], {duration: 200, easing: 'ease-in-out'});
    }
    document.body.appendChild(layer);
    this.layer = layer;
    // never left over (photo not found, navigation failed...)
    this.timer = window.setTimeout(() => this.hide(), 10000);
  }

  public static get active(): boolean {
    return !!this.layer;
  }

  /**
   * The lightbox shows the photo: the layer goes once the tile has grown to
   * full screen and the image of the lightbox (inside `lightbox`) is loaded,
   * so nothing shows twice or blinks.
   */
  public static async done(lightbox: HTMLElement): Promise<void> {
    if (!this.layer) {
      return;
    }
    const layer = this.layer;
    try {
      await this.growing?.finished;
    } catch {
      // cancelled: the layer went already
    }
    let frames = 0;
    const check = (): void => {
      if (layer !== this.layer) {
        return;
      }
      const img = lightbox.querySelector('img');
      if ((!img || !img.complete || !img.naturalWidth) && ++frames < 180) {
        requestAnimationFrame(check);
        return;
      }
      layer.animate([{opacity: 1}, {opacity: 0}], {duration: 100}).onfinish = () => {
        if (layer === this.layer) {
          this.hide();
        }
      };
    };
    requestAnimationFrame(check);
  }

  public static hide(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.layer?.remove();
    this.layer = null;
    this.growing = null;
  }
}
