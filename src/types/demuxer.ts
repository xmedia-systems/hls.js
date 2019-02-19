import { RemuxerResult } from './remuxer';

export interface Demuxer {
  append (data: Uint8Array, timeOffset: number, contiguous: boolean, accurateTimeOffset: boolean) : Promise<RemuxerResult>
  destroy() : void
  resetInitSegment(initSegment: any, audioCodec: string, videoCodec: string, duration: number);
  resetTimeStamp(defaultInitPTS): void
  setDecryptData(decryptData: any): void
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
