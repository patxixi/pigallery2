import {Injectable} from '@angular/core';
import {MediaDTO, MediaDTOUtils} from '../../../../../common/entities/MediaDTO';
import {Utils} from '../../../../../common/Utils';
import {UserRoles} from '../../../../../common/entities/UserDTO';
import {ExtensionService} from '../../../model/extension.service';
import {AuthenticationService} from '../../../model/network/authentication.service';
import {NetworkService} from '../../../model/network/network.service';
import {IClientMediaButtonConfigWithBaseApiPath} from '../grid/photo/photo.grid.gallery.component';

export interface BulkResult {
  done: number;
  failed: string[];
}

/**
 * Selection mode: several photos and/or directories are selected (instead of opening them)
 * to run an extension button on all of them at once, or to share them.
 * Paths are relative to the media folder, as the extension button routes expect them.
 */
@Injectable({
  providedIn: 'root'
})
export class SelectionService {
  public active = false;
  /**
   * Selected media by relative path (the media itself is unknown when selected by dragging).
   */
  public readonly media = new Map<string, MediaDTO | null>();
  /**
   * Selected directories (relative paths).
   */
  public readonly directories = new Set<string>();
  /**
   * Text shown in the bar while a bulk action or a download runs (e.g.: '3/10…').
   */
  public progress: string = null;

  constructor(private extensionService: ExtensionService,
              private authService: AuthenticationService,
              private networkService: NetworkService) {
  }

  public static mediaPath(m: MediaDTO): string {
    return Utils.concatUrls(m.directory.path, m.directory.name, m.name);
  }

  get count(): number {
    return this.media.size + this.directories.size;
  }

  get canSelect(): boolean {
    return this.authService.isAuthorized(UserRoles.User);
  }

  public start(): void {
    this.active = true;
  }

  public stop(): void {
    this.active = false;
    this.clear();
  }

  public clear(): void {
    this.media.clear();
    this.directories.clear();
    this.progress = null;
  }

  public isMediaSelected(m: MediaDTO): boolean {
    return this.media.has(SelectionService.mediaPath(m));
  }

  public toggleMedia(m: MediaDTO, selected?: boolean): void {
    if (this.justDragged) {
      return; // the click that ends a drag selection
    }
    const p = SelectionService.mediaPath(m);
    const select = selected ?? !this.media.has(p);
    if (select) {
      this.media.set(p, m);
    } else {
      this.media.delete(p);
    }
  }

  /**
   * Keys used on the tiles (data-selection attribute): 'm:<media path>' or 'd:<directory path>'.
   */
  public static mediaKey(m: MediaDTO): string {
    return 'm:' + SelectionService.mediaPath(m);
  }

  public static directoryKey(path: string): string {
    return 'd:' + path;
  }

  public hasKey(key: string): boolean {
    const path = key.slice(2);
    return key.startsWith('d:') ? this.directories.has(path) : this.media.has(path);
  }

  public setKey(key: string, selected: boolean): void {
    const path = key.slice(2);
    if (key.startsWith('d:')) {
      if (selected) {
        this.directories.add(path);
      } else {
        this.directories.delete(path);
      }
    } else if (selected) {
      if (!this.media.has(path)) {
        this.media.set(path, null);
      }
    } else {
      this.media.delete(path);
    }
  }

  /**
   * Time of the end of the last drag selection: the click that follows it must be ignored.
   */
  public dragEndedAt = 0;

  public get justDragged(): boolean {
    return Date.now() - this.dragEndedAt < 400;
  }

  public isDirectorySelected(path: string): boolean {
    return this.directories.has(path);
  }

  public toggleDirectory(path: string): void {
    if (this.justDragged) {
      return;
    }
    if (this.directories.has(path)) {
      this.directories.delete(path);
    } else {
      this.directories.add(path);
    }
  }

  public selectAll(media: MediaDTO[], directories: string[] = []): void {
    media.forEach(m => this.media.set(SelectionService.mediaPath(m), m));
    directories.forEach(d => this.directories.add(d));
  }

  /**
   * Selected photos (videos excluded: they can't be stripped of their location here).
   */
  get photoPaths(): string[] {
    return [...this.media.keys()].filter(p => !MediaDTOUtils.isVideoPath(p));
  }

  /**
   * Extension buttons offered in the selection mode for the current user.
   */
  get bulkButtons(): IClientMediaButtonConfigWithBaseApiPath[] {
    const buttons: IClientMediaButtonConfigWithBaseApiPath[] = [];
    (this.extensionService.UIExtensionConfig || []).forEach(config => {
      (config.mediaButtons || [])
        .filter(b => b.bulk && (b.bulkApiPath || b.apiPath))
        .filter(b => !b.minUserRole || this.authService.isAuthorized(b.minUserRole))
        .forEach(b => buttons.push({...b, extensionBasePath: config.extensionBasePath}));
    });
    return buttons;
  }

  /**
   * A button without bulkApiPath is called media by media: directories can't be handled.
   */
  public canRun(button: IClientMediaButtonConfigWithBaseApiPath): boolean {
    if (this.count === 0) {
      return false;
    }
    return !!button.bulkApiPath || this.directories.size === 0;
  }

  /**
   * Runs the button on the whole selection: one call to its bulkApiPath, or one call per media to its apiPath.
   */
  public async run(button: IClientMediaButtonConfigWithBaseApiPath,
                   data?: { fields?: Record<string, unknown>, customFields?: Record<string, unknown> }): Promise<BulkResult> {
    const media = [...this.media.keys()];
    const directories = [...this.directories];
    if (button.bulkApiPath) {
      this.progress = '…';
      try {
        await this.networkService.postJson(Utils.concatUrls(button.extensionBasePath, button.bulkApiPath),
          {media, directories, data});
        return {done: media.length + directories.length, failed: []};
      } catch (e) {
        return {done: 0, failed: [...directories, ...media]};
      } finally {
        this.progress = null;
      }
    }
    const result: BulkResult = {done: 0, failed: []};
    for (const m of media) {
      this.progress = `${result.done + result.failed.length + 1}/${media.length}…`;
      try {
        await this.networkService.postJson(Utils.concatUrls(button.extensionBasePath, button.apiPath), {media: m, data});
        result.done++;
      } catch (e) {
        result.failed.push(m);
      }
    }
    this.progress = null;
    return result;
  }
}
