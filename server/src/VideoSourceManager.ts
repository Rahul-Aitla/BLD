import * as wrtc from '@roamhq/wrtc';
import sharp from 'sharp';

interface RTCVideoFrameInput {
  width: number;
  height: number;
  data: Uint8Array;
  chroma?: string;
}

export class VideoSourceManager {
  private source: wrtc.nonstandard.RTCVideoSource;
  private track: wrtc.MediaStreamTrack;
  private frameCount = 0;
  private i420Pool: Map<string, Uint8Array> = new Map();

  constructor() {
    this.source = new wrtc.nonstandard.RTCVideoSource({ isScreencast: true });
    this.track = this.source.createTrack();
  }

  async feedFrame(jpegBuffer: Buffer, _metadataWidth?: number, _metadataHeight?: number): Promise<void> {
    const img = sharp(jpegBuffer);
    const meta = await img.metadata();
    const w = meta.width!;
    const h = meta.height!;
    const key = `${w}x${h}`;

    const rgbaBuffer = await img.ensureAlpha().raw().toBuffer();

    let i420Data = this.i420Pool.get(key);
    const i420Size = w * h + 2 * Math.ceil(w / 2) * Math.ceil(h / 2);
    if (!i420Data || i420Data.length !== i420Size) {
      i420Data = new Uint8Array(i420Size);
      this.i420Pool.set(key, i420Data);
    }

    const rgbaFrame: wrtc.nonstandard.RTCVideoFrame = {
      width: w,
      height: h,
      data: new Uint8Array(rgbaBuffer.buffer, rgbaBuffer.byteOffset, rgbaBuffer.byteLength),
    };
    const i420Frame: wrtc.nonstandard.RTCVideoFrame = {
      width: w,
      height: h,
      data: i420Data,
    };

    wrtc.nonstandard.rgbaToI420(rgbaFrame, i420Frame);

    this.source.onFrame({ ...i420Frame, chroma: '420' } as RTCVideoFrameInput);
    this.frameCount++;
  }

  getTrack(): wrtc.MediaStreamTrack {
    return this.track;
  }

  getSource(): wrtc.nonstandard.RTCVideoSource {
    return this.source;
  }

  getFrameCount(): number {
    return this.frameCount;
  }

  stop(): void {
    this.track.stop();
  }
}
