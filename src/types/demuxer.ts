import { RemuxerResult } from './remuxer';

export interface Demuxer {
  demux (data: Uint8Array, contiguous: boolean, isSampleAes: boolean) : DemuxerResult
  demuxSampleAes (data: Uint8Array, decryptData: Uint8Array, contiguous) : Promise<DemuxerResult>
  destroy() : void
  resetInitSegment(initSegment: any, audioCodec: string, videoCodec: string, duration: number);
  resetTimeStamp(defaultInitPTS): void
}

export interface DemuxerResult {
  audioTrack: any
  avcTrack: any
  id3Track: any
  textTrack: any
}

export interface IDemuxerInline {
  push (data: ArrayBuffer,
        decryptdata: ArrayBuffer | null,
        initSegment: any,
        audioCodec: string,
        videoCodec: string,
        timeOffset: number,
        discontinuity: boolean,
        trackSwitch: boolean,
        contiguous: boolean,
        duration: number,
        accurateTimeOffset: boolean,
        defaultInitPTS: number
  ): Promise<RemuxerResult>
}
