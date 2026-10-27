import {Component, EventEmitter, Injector, Input, NgZone, OnDestroy, OnInit, Output} from '@angular/core';
import {DragSelect} from './drag-select';
import {NgFor, NgIf} from '@angular/common';
import {MediaDTO} from '../../../../../common/entities/MediaDTO';
import {Config} from '../../../../../common/config/public/Config';
import {Utils} from '../../../../../common/Utils';
import {SafeHtmlPipe} from '../../../pipes/SafeHTMLPipe';
import {SelectionService} from './selection.service';
import {IClientMediaButtonConfigWithBaseApiPath} from '../grid/photo/photo.grid.gallery.component';
import {MediaButtonModalService} from '../grid/photo/media-button-modal/media-button-modal.service';
import {jpegWithoutGps, toJpeg} from './strip-gps';
import {ExtensionService} from '../../../model/extension.service';
import {AuthenticationService} from '../../../model/network/authentication.service';
import {NetworkService} from '../../../model/network/network.service';
import {UserRoles} from '../../../../../common/entities/UserDTO';

/**
 * Floating bar of the selection mode: start/cancel, count, select all, share
 * (originals without their location) and the extension buttons offered in bulk.
 */
@Component({
  selector: 'app-selection-bar',
  templateUrl: './selection-bar.component.html',
  styleUrls: ['./selection-bar.component.css'],
  imports: [NgIf, NgFor, SafeHtmlPipe]
})
export class SelectionBarComponent implements OnInit, OnDestroy {
  /**
   * Returns everything that "select all" can select on the current page (null: no "select all").
   */
  @Input() selectAllSource: () => { media: MediaDTO[], directories: string[] } = null;
  /**
   * Emitted after a bulk action changed the data, so the page can reload.
   */
  @Output() changed = new EventEmitter<void>();

  /**
   * Files downloaded for sharing, waiting for a second tap (see share()).
   */
  readyToShare: File[] = null;
  downloading = false;

  private readonly dragSelect: DragSelect;

  private buttons: IClientMediaButtonConfigWithBaseApiPath[] = null;

  constructor(public selection: SelectionService,
              private authService: AuthenticationService,
              private injector: Injector,
              zone: NgZone) {
    this.dragSelect = new DragSelect(selection, zone, () => this.canSelect);
  }

  /**
   * Extension buttons offered in bulk to the current user. Services are fetched only when the
   * selection mode is used: pages that just show the bar don't depend on them.
   */
  get bulkButtons(): IClientMediaButtonConfigWithBaseApiPath[] {
    if (this.buttons === null) {
      this.buttons = SelectionService.bulkButtons(this.injector.get(ExtensionService).UIExtensionConfig,
        (role) => this.authService.isAuthorized(role));
    }
    return this.buttons;
  }

  get canSelect(): boolean {
    return this.authService.isAuthorized(UserRoles.User);
  }

  ngOnInit(): void {
    this.dragSelect.attach();
  }

  ngOnDestroy(): void {
    this.dragSelect.detach();
    this.selection.stop();
  }

  get summary(): string {
    const parts: string[] = [];
    const d = this.selection.directories.size;
    const m = this.selection.media.size;
    if (d) {
      parts.push(d === 1 ? $localize`1 folder` : $localize`${d}:COUNT: folders`);
    }
    if (m || !d) {
      parts.push(m === 1 ? $localize`1 item` : $localize`${m}:COUNT: items`);
    }
    return parts.join(', ');
  }

  toggleMode(): void {
    if (this.selection.active) {
      this.selection.stop();
      this.readyToShare = null;
    } else {
      this.selection.start();
    }
  }

  selectAll(): void {
    this.readyToShare = null;
    const all = this.selectAllSource();
    this.selection.selectAll(all.media, all.directories);
  }

  runButton(button: IClientMediaButtonConfigWithBaseApiPath): void {
    if (!this.selection.canRun(button)) {
      return;
    }
    const label = this.summary + (this.selection.directories.size ? $localize` (whole folders)` : '');
    if (button.popup) {
      this.injector.get(MediaButtonModalService).showModal(button, null, (formData) => this.execute(button, formData), label);
      return;
    }
    if (!window.confirm(`${button.name}: ${label}?`)) {
      return;
    }
    this.execute(button).catch(console.error);
  }

  private async execute(button: IClientMediaButtonConfigWithBaseApiPath,
                        formData?: { fields?: Record<string, unknown>, customFields?: Record<string, unknown> }): Promise<void> {
    // fetched only when needed: pages that just show the bar don't depend on the network service
    const network = this.injector.get(NetworkService);
    const result = await this.selection.run(button, formData, (url, body) => network.postJson(url, body));
    if (result.failed.length) {
      window.alert($localize`Done: ${result.done}:DONE:, failed: ${result.failed.length}:FAILED:` + '\n' + result.failed.slice(0, 10).join('\n'));
    }
    this.selection.stop();
    this.changed.emit();
  }

  private static originalUrl(path: string): string {
    return Utils.concatUrls(Config.Server.urlBase, Config.Server.apiPath, '/gallery/content/',
      path.split('/').map(encodeURIComponent).join('/'));
  }

  /**
   * A shareable file without location. Formats the browser can't read (e.g.: HEIC on Android)
   * are taken from the 1080 px preview of the gallery.
   */
  private static async withoutLocation(path: string, blob: Blob): Promise<File> {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const base = name.replace(/\.[^.]*$/, '');
    if (/\.(jpe?g|jpe)$/i.test(name)) {
      const clean = jpegWithoutGps(await blob.arrayBuffer());
      if (clean) {
        return new File([clean], name, {type: 'image/jpeg'});
      }
    }
    let jpeg: Blob;
    try {
      jpeg = await toJpeg(blob);
    } catch (e) {
      const r = await fetch(SelectionBarComponent.originalUrl(path) + '/1080', {credentials: 'same-origin'});
      if (!r.ok) {
        throw new Error(`${path}: ${r.status}`);
      }
      jpeg = await toJpeg(await r.blob());
    }
    return new File([jpeg], base + '.jpg', {type: 'image/jpeg'});
  }

  /**
   * Shares the original photos without their location (videos are skipped: their location
   * can't be removed here). The browser opens the share menu only right after a tap: if the
   * download took long, a second tap is needed. Without file sharing, the files are downloaded.
   */
  async share(): Promise<void> {
    if (this.readyToShare) {
      return this.openShareMenu();
    }
    const photos = this.selection.photoPaths;
    const videos = this.selection.media.size - photos.length;
    if (videos) {
      window.alert($localize`${videos}:COUNT: video(s) not shared: their location can't be removed here. Use a sharing link for videos.`);
    }
    if (!photos.length) {
      return;
    }
    this.downloading = true;
    const files: File[] = [];
    let total = 0;
    try {
      for (const path of photos) {
        this.selection.progress = `${files.length + 1}/${photos.length} (${Math.round(total / 1e6)} MB)…`;
        const r = await fetch(SelectionBarComponent.originalUrl(path), {credentials: 'same-origin'});
        if (!r.ok) {
          throw new Error(`${path}: ${r.status}`);
        }
        const f = await SelectionBarComponent.withoutLocation(path, await r.blob());
        total += f.size;
        files.push(f);
      }
    } catch (e) {
      window.alert($localize`Download failed:` + ' ' + (e.message || e));
      return;
    } finally {
      this.downloading = false;
      this.selection.progress = null;
    }
    if (navigator.canShare && navigator.canShare({files})) {
      this.readyToShare = files;
      return this.openShareMenu();
    }
    for (const f of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 60000);
    }
  }

  private async openShareMenu(): Promise<void> {
    try {
      await navigator.share({files: this.readyToShare});
      this.readyToShare = null;
      this.selection.stop();
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        return; // no recent tap anymore: the button now says "Send", a second tap opens the menu
      }
      this.readyToShare = null;
      if (e.name !== 'AbortError') {
        window.alert($localize`Sharing failed:` + ' ' + (e.message || e));
      }
    }
  }
}
