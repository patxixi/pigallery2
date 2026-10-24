import {SQLConnection} from './SQLConnection';
import {AlbumBaseEntity} from './enitites/album/AlbumBaseEntity';
import {ObjectManagers} from '../ObjectManagers';
import {SearchQueryDTO} from '../../../common/entities/SearchQueryDTO';
import {SavedSearchEntity} from './enitites/album/SavedSearchEntity';
import {Logger} from '../../Logger';
import {SessionContext} from '../SessionContext';
import {ProjectedAlbumCacheEntity} from './enitites/album/ProjectedAlbumCacheEntity';
import {ProjectionAwareManager} from './ProjectionAwareManager';
import {NotificationManager} from '../NotifocationManager';
import {Job} from '../jobs/jobs/Job';

const LOG_TAG = '[AlbumManager]';

export class AlbumManager extends ProjectionAwareManager<AlbumBaseEntity> {
  /**
   * Running background refresh per projection (single-flight).
   */
  private refreshing: Record<string, Promise<void>> = {};

  public async addIfNotExistSavedSearch(
    name: string,
    searchQuery: SearchQueryDTO,
    lockedAlbum: boolean
  ): Promise<void> {
    const connection = await SQLConnection.getConnection();
    const album = await connection
      .getRepository(SavedSearchEntity)
      .findOneBy({name, searchQuery});
    if (album) {
      return;
    }
    await this.addSavedSearch(name, searchQuery, lockedAlbum);
    this.resetMemoryCache();
  }

  public async addSavedSearch(
    name: string,
    searchQuery: SearchQueryDTO,
    lockedAlbum?: boolean
  ): Promise<void> {
    const connection = await SQLConnection.getConnection();
    await connection
      .getRepository(SavedSearchEntity)
      .save({name, searchQuery, locked: lockedAlbum});
    this.resetMemoryCache();
  }

  public async deleteAlbum(id: number): Promise<void> {
    const connection = await SQLConnection.getConnection();
    const albumCount = await connection
      .getRepository(AlbumBaseEntity)
      .countBy({id, locked: false});

    if (albumCount == 0) {
      throw new Error(`Could not delete album, id: ${id}. Album id is not found or the album is locked.`);
    }

    if (albumCount > 1) {
      throw new Error(`Could not delete album, id: ${id}. DB is inconsistent. More than one album is found with the given id.`);
    }

    await connection
      .getRepository(AlbumBaseEntity)
      .delete({id, locked: false});

    this.resetMemoryCache();
  }

  async deleteAll() {
    const connection = await SQLConnection.getConnection();
    await connection
      .getRepository(AlbumBaseEntity)
      .createQueryBuilder('album')
      .delete()
      .execute();
    this.resetMemoryCache();
  }

  /**
   * Albums with their last computed cache (count, cover), even if it is outdated.
   * Any data change invalidates every album, and recomputing hundreds of
   * saved searches can take tens of seconds on a weak server. So outdated
   * albums are returned right away and recomputed in the background;
   * only albums that were never computed are waited for.
   */
  protected async loadEntities(session: SessionContext): Promise<AlbumBaseEntity[]> {
    let albums = await this.queryAlbums(session);
    if (albums.every(a => a.cache?.valid)) {
      return albums;
    }
    const refresh = this.refreshInBackground(session);
    if (albums.some(a => !a.cache)) {
      await refresh;
      albums = await this.queryAlbums(session);
    }
    return albums;
  }

  /**
   * Resolves when the background refresh of the given projection (if any) is done.
   */
  public async waitForRefresh(session: SessionContext): Promise<void> {
    await this.refreshing[session.user.projectionKey];
  }

  private refreshInBackground(session: SessionContext): Promise<void> {
    const key = session.user.projectionKey;
    if (!this.refreshing[key]) {
      this.refreshing[key] = this.updateAlbums(session)
        .catch(e => Logger.error(LOG_TAG, 'Could not refresh albums', e))
        .finally(() => {
          delete this.refreshing[key];
        });
    }
    return this.refreshing[key];
  }

  private async queryAlbums(session: SessionContext): Promise<AlbumBaseEntity[]> {
    const connection = await SQLConnection.getConnection();
    return connection
      .getRepository(AlbumBaseEntity)
      .createQueryBuilder('album')
      .leftJoin('album.cache', 'cache', 'cache.projectionKey = :pk', {pk: session.user.projectionKey})
      .leftJoin('cache.cover', 'cover')
      .leftJoin('cover.directory', 'directory')
      .select(['album', 'cache', 'cover.name', 'directory.name', 'directory.path'])
      .getMany();
  }

  protected async invalidateDBCache(): Promise<void> {
    // Invalidate all album cache entries
    const connection = await SQLConnection.getConnection();
    await connection.getRepository(ProjectedAlbumCacheEntity)
      .createQueryBuilder()
      .update()
      .set({valid: false})
      .execute();
  }

  private async updateAlbums(session: SessionContext): Promise<void> {
    Logger.debug(LOG_TAG, 'Updating derived album data');
    const connection = await SQLConnection.getConnection();
    const albums = await connection
      .getRepository(SavedSearchEntity)
      .createQueryBuilder('album')
      .leftJoinAndSelect('album.cache', 'cache', 'cache.projectionKey = :pk AND cache.valid = 1', {pk: session.user.projectionKey})
      .getMany();

    for (const a of albums) {
      try {
        if (a.cache?.valid === true) {
          continue;
        }
        await ObjectManagers.getInstance().ProjectedCacheManager
          .setAndGetCacheForAlbum(connection, session, {
            id: a.id,
            searchQuery: a.searchQuery,
            name: a.name
          });
        // giving back the control to the main event loop (Macrotask queue)
        // https://blog.insiderattack.net/promises-next-ticks-and-immediates-nodejs-event-loop-part-3-9226cbe7a6aa
        await new Promise(setImmediate);
      } catch (e) {
        Logger.error(LOG_TAG, `Could not update album data for album '${a.name}', query: ${JSON.stringify(a.searchQuery)}`, e);
        NotificationManager.warning(`Could not update album data`, {
          id: a.id,
          searchQuery: a.searchQuery,
          name: a.name,
          error: e.toString()
        });
      }
    }
    this.resetMemoryCache();
  }

}
