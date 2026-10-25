import {expect} from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sharp from 'sharp';
import {ImageRendererFactory, MediaRendererInput, ThumbnailSourceType} from '../../../../../src/backend/model/fileaccess/PhotoWorker';


describe('ImageRendererFactory decode memory guard', () => {

  it('should estimate whole-frame formats far above streamed baseline JPEGs', () => {
    const progressive = ImageRendererFactory.estimateDecodeMemory({width: 12114, height: 4973, format: 'jpeg', isProgressive: true});
    const heic = ImageRendererFactory.estimateDecodeMemory({width: 5712, height: 4284, format: 'heif', isProgressive: false});
    const baseline = ImageRendererFactory.estimateDecodeMemory({width: 9248, height: 6936, format: 'jpeg', isProgressive: false});
    expect(progressive).to.be.within(380, 420);
    expect(heic).to.be.within(150, 180);
    expect(baseline).to.be.below(40);
  });

  it('should only refuse above the limit, and never without one', () => {
    const big = {width: 12114, height: 4973, format: 'jpeg' as const, isProgressive: true};
    expect(() => ImageRendererFactory.checkDecodeMemory(big, 0, 'big.jpg')).to.not.throw();
    expect(() => ImageRendererFactory.checkDecodeMemory(big, 500, 'big.jpg')).to.not.throw();
    expect(() => ImageRendererFactory.checkDecodeMemory(big, 180, 'big.jpg')).to.throw(/big\.jpg.*maxDecodeMemory \(180 MB\)/);
  });

  it('should refuse to render a progressive JPEG above the limit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg2-decode-'));
    const src = path.join(dir, 'progressive.jpg');
    await sharp({create: {width: 600, height: 600, channels: 3, background: '#808080'}})
      .jpeg({progressive: true}).toFile(src);
    const input = {
      type: ThumbnailSourceType.Photo, mediaPath: src, outPath: path.join(dir, 'out.webp'), size: 100, quality: 80,
      makeSquare: false, useLanczos3: true, smartSubsample: false, animate: false, sharpOptions: {},
    } as unknown as MediaRendererInput;
    try {
      // 600x600 at 7 bytes/pixel is about 2.4 MB
      input.maxDecodeMemory = 1;
      let error: Error = null;
      await ImageRendererFactory.render(input).catch((e: Error) => error = e);
      expect(error).to.not.equal(null);
      expect(error.message).to.contain('maxDecodeMemory');
      expect(fs.existsSync(input.outPath)).to.equal(false);

      input.maxDecodeMemory = 10;
      await ImageRendererFactory.render(input);
      expect(fs.existsSync(input.outPath)).to.equal(true);
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});
