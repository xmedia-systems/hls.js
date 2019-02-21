import { InitSegmentData, RemuxerResult } from './remuxer';

export interface Demuxer {
  demux (data: Uint8Array, timeOffset: number, contiguous: boolean, isSampleAes?: boolean) : DemuxerResult
  demuxSampleAes (data: Uint8Array, decryptData: Uint8Array, timeOffset: number, contiguous: boolean) : Promise<DemuxerResult>
  destroy() : void
  resetInitSegment(initSegment: any, audioCodec: string, videoCodec: string, duration: number);
  resetTimeStamp(defaultInitPTS): void
}

export interface DemuxerResult {
  audioTrack: any
  avcTrack: any
  id3Track: any
  textTrack: any
  startDTS?: number
  initSegment?: InitSegmentData
}
