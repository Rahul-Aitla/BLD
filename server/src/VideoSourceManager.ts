import * as wrtc from '@roamhq/wrtc';
import sharp from 'sharp';

export class VideoSourceManager {
  private source: wrtc.nonstandard.RTCVideoSource;
  private frameCount = 0;

  constructor() {
    this.source = new wrtc.nonstandard.RTCVideoSource({ isScreencast: true });
  }

  async feedFrame(jpegBuffer: Buffer, metadataWidth?: number, metadataHeight?: number): Promise<void> {
    const OUTPUT_WIDTH = metadataWidth ?? 1280;
    const OUTPUT_HEIGHT = metadataHeight ?? 720;

    const rgbaBuffer = await sharp(jpegBuffer)
      .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer();

    const i420Size = OUTPUT_WIDTH * OUTPUT_HEIGHT + 2 * Math.ceil(OUTPUT_WIDTH / 2) * Math.ceil(OUTPUT_HEIGHT / 2);
    const i420Data = new Uint8Array(i420Size);
    const rgbaData = new Uint8Array(rgbaBuffer.buffer, rgbaBuffer.byteOffset, rgbaBuffer.byteLength);

    const rgbaFrame: wrtc.nonstandard.RTCVideoFrame = {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      data: rgbaData,
    };
    const i420Frame: wrtc.nonstandard.RTCVideoFrame = {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      data: i420Data,
    };

    wrtc.nonstandard.rgbaToI420(rgbaFrame, i420Frame);

    this.source.onFrame(i420Frame);
    this.frameCount++;
  }

  createTrack(): wrtc.MediaStreamTrack {
    return this.source.createTrack();
  }

  getSource(): wrtc.nonstandard.RTCVideoSource {
    return this.source;
  }

  getFrameCount(): number {
    return this.frameCount;
  }

  stop(): void {
    // RTCVideoSource has no stop method; tracks are closed by the caller
  }
}
