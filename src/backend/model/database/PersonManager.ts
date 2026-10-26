import {SQLConnection} from './SQLConnection';
import {PersonEntry} from './enitites/person/PersonEntry';
import {PersonDTO} from '../../../common/entities/PersonDTO';
import {FaceRegion} from '../../../common/entities/PhotoDTO';
import {Logger} from '../../Logger';
import {SQL_COLLATE} from './enitites/EntityUtils';
import {PersonJunctionTable} from './enitites/person/PersonJunctionTable';
import {ParentDirectoryDTO} from '../../../common/entities/DirectoryDTO';
import {ProjectedPersonCacheEntity} from './enitites/person/ProjectedPersonCacheEntity';
import {SessionContext} from '../SessionContext';
import {ProjectionAwareManager} from './ProjectionAwareManager';
import {Config} from '../../../common/config/private/Config';
import {ProjectPath} from '../../ProjectPath';
import {promises as fsp} from 'fs';
import * as path from 'path';

const LOG_TAG = '[PersonManager]';

export interface SampleCandidate {
  id: number;
  rating: number;
  date: number;
  faces: string | FaceRegion[];
  width?: number;
  height?: number;
  path?: string; // relative to the media folder
}

export class PersonManager extends ProjectionAwareManager<PersonEntry> {

  async updatePerson(
    name: string,
    partialPerson: PersonDTO
  ): Promise<void> {
    const connection = await SQLConnection.getConnection();
    const repository = connection.getRepository(PersonEntry);
    const person = await repository
      .createQueryBuilder('person')
      .limit(1)
      .where('person.name LIKE :name COLLATE ' + SQL_COLLATE, {name})
      .getOne();

    if (typeof partialPerson.name !== 'undefined') {
      person.name = partialPerson.name;
    }
    if (typeof partialPerson.isFavourite !== 'undefined') {
      person.isFavourite = partialPerson.isFavourite;
    }
    await repository.save(person);

    // reset memory cache after person update. DB cache entry did not change, no need to reset that
    this.resetMemoryCache();

    return;
  }

  /**
   * Used for statistic
   */
  public async countFaces(): Promise<number> {
    const connection = await SQLConnection.getConnection();
    return await connection
      .getRepository(PersonJunctionTable)
      .createQueryBuilder('personJunction')
      .getCount();
  }

  public async get(session: SessionContext, name: string): Promise<PersonEntry> {
    const persons = await this.getAll(session);
    return persons.find((p): boolean => p.name === name);
  }

  public async saveAll(
    persons: { name: string; mediaId: number }[]
  ): Promise<void> {
    const toSave: { name: string; mediaId: number }[] = [];
    const connection = await SQLConnection.getConnection();
    const personRepository = connection.getRepository(PersonEntry);
    const personJunction = connection.getRepository(PersonJunctionTable);

    const savedPersons = await personRepository.find();
    // filter already existing persons
    for (const personToSave of persons) {
      const person = savedPersons.find(
        (p): boolean => p.name === personToSave.name
      );
      if (!person) {
        toSave.push(personToSave);
      }
    }

    if (toSave.length > 0) {
      for (let i = 0; i < toSave.length / 200; i++) {
        const saving = toSave.slice(i * 200, (i + 1) * 200);
        // saving person
        const inserted = await personRepository.insert(
          saving.map((p) => ({name: p.name}))
        );
        // saving junction table
        const junctionTable = inserted.identifiers.map((idObj, j) => ({person: idObj, media: {id: saving[j].mediaId}}));
        await personJunction.insert(junctionTable);
      }
    }
  }

  /**
   * The sample (junction id) to show for a person: best rated, then the
   * largest face of that person in pixels, then the newest photo.
   */
  /**
   * Picks the face shown as the person's portrait. A path listed for the
   * person in <dbFolder>/person-samples.json wins (written by an external
   * face analysis, see README). Otherwise: best rated, then a usable face
   * (whole face with its margin inside the photo, at most a sliver of another
   * face in the crop, not a close-up, at least 200 px), then the largest face,
   * then the newest.
   */
  public static pickSample(candidates: SampleCandidate[], personName: string, preferredPath?: string): number {
    const margin = Config.Media.Photo.personFaceMargin / 2;
    let best: { id: number, key: number[] } = null;
    for (const c of candidates) {
      let faces: FaceRegion[] = [];
      try {
        faces = (typeof c.faces === 'string' ? JSON.parse(c.faces) : c.faces) || [];
      } catch (e) {
        // unreadable faces: area 0
      }
      const face = faces.find(f => f.name === personName);
      const box = face?.box;
      const area = box ? box.width * box.height : 0;
      let framed = false;
      let alone = false;
      let closeUp = true;
      if (box && c.width && c.height) {
        const cut = {
          left: box.left - box.width * margin,
          top: box.top - box.height * margin,
          right: box.left + box.width * (1 + margin),
          bottom: box.top + box.height * (1 + margin),
        };
        framed = cut.left >= 0 && cut.top >= 0 && cut.right <= c.width && cut.bottom <= c.height;
        // a sliver of a neighbour's face in the crop is fine
        alone = !faces.some(f => {
          if (f === face || !f.box) {
            return false;
          }
          const w = Math.min(cut.right, f.box.left + f.box.width) - Math.max(cut.left, f.box.left);
          const h = Math.min(cut.bottom, f.box.top + f.box.height) - Math.max(cut.top, f.box.top);
          return w > 0 && h > 0 && w * h > PersonManager.NEIGHBOUR_SHARE * f.box.width * f.box.height;
        });
        closeUp = Math.max(box.width / c.width, box.height / c.height) > PersonManager.CLOSE_UP_RATIO;
      }
      const usable = framed && alone && !closeUp && area >= PersonManager.MIN_FACE_SIDE * PersonManager.MIN_FACE_SIDE;
      const preferred = !!preferredPath && !!box && c.path === preferredPath;
      const key = [+preferred, c.rating || 0, +usable, +(framed && alone), +framed, area, Number(c.date) || 0];
      if (!best || PersonManager.compareKeys(key, best.key) > 0) {
        best = {id: c.id, key};
      }
    }
    return best ? best.id : null;
  }

  private static readonly CLOSE_UP_RATIO = 0.35;
  private static readonly MIN_FACE_SIDE = 200;
  private static readonly NEIGHBOUR_SHARE = 0.3;

  private static compareKeys(a: number[], b: number[]): number {
    for (let i = 0; i < a.length; ++i) {
      if (a[i] !== b[i]) {
        return a[i] - b[i];
      }
    }
    return 0;
  }

  /**
   * Optional {"person name": "dir/sub/photo.jpg"} in the database folder,
   * paths relative to the media folder.
   */
  private static async loadPreferredSamples(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fsp.readFile(path.join(ProjectPath.DBFolder, PersonManager.SAMPLES_FILE), 'utf8')) || {};
    } catch (e) {
      if (e.code !== 'ENOENT') {
        Logger.warn(LOG_TAG, 'Ignoring ' + PersonManager.SAMPLES_FILE + ': ' + e.message);
      }
      return {};
    }
  }

  public static readonly SAMPLES_FILE = 'person-samples.json';

  protected async invalidateDBCache(changedDir?: ParentDirectoryDTO): Promise<void> {
    if (!changedDir || !changedDir.id) {
      await this.invalidateAllDBCache();
      return;
    }
    try {
      const connection = await SQLConnection.getConnection();

      // Collect affected person ids from this directory (non-recursive)
      const rows = await connection.getRepository(PersonJunctionTable)
        .createQueryBuilder('pjt')
        .innerJoin('pjt.media', 'm')
        .innerJoin('m.directory', 'd')
        .innerJoin('pjt.person', 'person')
        .where('d.id = :dirId', {dirId: changedDir.id})
        .select('DISTINCT person.id', 'pid')
        .getRawMany();

      const pids = rows.map((r: any) => parseInt(r.pid, 10)).filter((n: number) => !isNaN(n));
      if (pids.length === 0) {
        return;
      }

      // Mark projection-aware person cache entries invalid for these persons
      await connection.getRepository(ProjectedPersonCacheEntity)
        .createQueryBuilder()
        .update()
        .set({valid: false})
        .where('personId IN (:...pids)', {pids})
        .execute();
    } catch (err) {
      Logger.warn(LOG_TAG, 'Failed to invalidate projected person cache on data change', err);
    }
  }

  protected async loadEntities(session: SessionContext): Promise<PersonEntry[]> {
    await this.updateCacheForAll(session);
    const connection = await SQLConnection.getConnection();
    const personRepository = connection.getRepository(PersonEntry);
    return await personRepository
      .createQueryBuilder('person')
      .leftJoin('person.cache', 'cache', 'cache.projectionKey = :pk', {pk: session.user.projectionKey})
      .leftJoin('cache.sampleRegion', 'sampleRegion')
      .leftJoin('sampleRegion.media', 'media')
      .leftJoin('media.directory', 'directory')
      .select([
        'person.id',
        'person.name',
        'person.isFavourite',
        'cache.count',
        'sampleRegion',
        'media',
        'directory.path',
        'directory.name'
      ])
      .where('cache.valid = 1 AND cache.count > 0')
      .getMany();
  }

  private async invalidateAllDBCache(): Promise<void> {
    const connection = await SQLConnection.getConnection();
    await connection.getRepository(ProjectedPersonCacheEntity)
      .createQueryBuilder()
      .update()
      .set({valid: false})
      .execute();
  }

  private async updateCacheForAll(session: SessionContext): Promise<void> {
    const connection = await SQLConnection.getConnection();
    const projectionKey = session.user.projectionKey;

    // Get all persons that need cache updates (either missing or invalid)
    const personsNeedingUpdate = await connection
      .getRepository(PersonEntry)
      .createQueryBuilder('person')
      .leftJoin('person.cache', 'cache', 'cache.projectionKey = :projectionKey', {projectionKey})
      .where('cache.id IS NULL OR cache.valid = false')
      .select(['person.id', 'person.name'])
      .getMany();

    if (personsNeedingUpdate.length === 0) {
      return;
    }

    // Process persons in batches to avoid memory issues
    const batchSize = 200;
    for (let i = 0; i < personsNeedingUpdate.length; i += batchSize) {
      const batch = personsNeedingUpdate.slice(i, i + batchSize);
      const personIds = batch.map(p => p.id);

      // Build base query for person junction table with projection constraints
      const baseQb = connection
        .getRepository(PersonJunctionTable)
        .createQueryBuilder('pjt')
        .innerJoin('pjt.media', 'media')
        .where('pjt.person IN (:...personIds)', {personIds});

      // Apply projection query if it exists
      if (session.projectionQuery) {
        if (session.hasDirectoryProjection) {
          baseQb.leftJoin('media.directory', 'directory');
        }
        baseQb.andWhere(session.projectionQuery);
      }

      // Compute counts per person
      const countResults = await baseQb
        .clone()
        .select(['pjt.person as personId', 'COUNT(*) as count'])
        .groupBy('pjt.person')
        .getRawMany();
      // Compute sample regions per person (see pickSample)
      // Use individual queries per person to ensure compatibility with older SQLite versions
      const topSamples: Record<number, number> = {};
      const names: Record<number, string> = {};
      batch.forEach(p => names[p.id] = p.name);
      const preferred = await PersonManager.loadPreferredSamples();
      for (const personId of personIds) {
        const sampleQb = connection
          .getRepository(PersonJunctionTable)
          .createQueryBuilder('pjt')
          .innerJoin('pjt.media', 'media')
          .leftJoin('media.directory', 'directory')
          .where('pjt.person = :personId', {personId});

        // Apply projection query if it exists
        if (session.projectionQuery) {
          sampleQb.andWhere(session.projectionQuery);
        }

        const rows: { id: number, rating: number, date: number, faces: string, width: number, height: number,
          dirPath: string, dirName: string, name: string }[] = await sampleQb
          .select('pjt.id', 'id')
          .addSelect('media.metadataRating', 'rating')
          .addSelect('media.metadataCreationdate', 'date')
          .addSelect('media.metadataFaces', 'faces')
          .addSelect('media.metadataSizeWidth', 'width')
          .addSelect('media.metadataSizeHeight', 'height')
          .addSelect('directory.path', 'dirPath')
          .addSelect('directory.name', 'dirName')
          .addSelect('media.name', 'name')
          .getRawMany();
        const candidates: SampleCandidate[] = rows.map(r => ({
          ...r,
          path: path.posix.join(r.dirPath || '', r.dirName || '', r.name)
        }));
        const best = PersonManager.pickSample(candidates, names[personId], preferred[names[personId]]);
        if (best !== null) {
          topSamples[personId] = best;
        }
      }

      // Build count lookup
      const counts = countResults.reduce((acc: Record<number, number>, r: any) => {
        acc[parseInt(r.personId, 10)] = parseInt(r.count, 10);
        return acc;
      }, {});

      // Batch upsert cache entries to minimize DB transactions
      const cacheRepo = connection.getRepository(ProjectedPersonCacheEntity);
      const cacheEntriesToSave: ProjectedPersonCacheEntity[] = [];

      // Get existing cache entries for this batch
      const existingEntries = await cacheRepo
        .createQueryBuilder('cache')
        .leftJoinAndSelect('cache.person', 'person')
        .where('cache.projectionKey = :projectionKey', {projectionKey})
        .andWhere('cache.person IN (:...personIds)', {personIds})
        .getMany();

      const existingByPersonId = existingEntries.reduce((acc, entry) => {
        acc[entry.person.id] = entry;
        return acc;
      }, {} as Record<number, ProjectedPersonCacheEntity>);

      for (const person of batch) {
        const count = counts[person.id] || 0;
        const sampleRegionId = topSamples[person.id] || null;

        let cacheEntry = existingByPersonId[person.id];
        if (cacheEntry) {
          // Update existing entry
          cacheEntry.count = count;
          cacheEntry.sampleRegion = sampleRegionId ? {id: sampleRegionId} as any : null;
          cacheEntry.valid = true;
        } else {
          // Create new entry
          cacheEntry = new ProjectedPersonCacheEntity();
          cacheEntry.projectionKey = projectionKey;
          cacheEntry.person = {id: person.id} as any;
          cacheEntry.count = count;
          cacheEntry.sampleRegion = sampleRegionId ? {id: sampleRegionId} as any : null;
          cacheEntry.valid = true;
        }

        cacheEntriesToSave.push(cacheEntry);
      }

      // Batch save all cache entries for this batch
      if (cacheEntriesToSave.length > 0) {
        await cacheRepo.save(cacheEntriesToSave);
      }
    }
  }

}
