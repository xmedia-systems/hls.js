import { TrackSet } from './track';

export interface Remuxer {
  remux(audioTrack: any,
        videoTrack: any,
        id3Track:any,
        textTrack: any,
        timeOffset: number,
        contiguous: boolean,
        accurateTimeOffset: boolean
  ): RemuxerResult
  resetInitSegment(): void
  resetTimeStamp(defaultInitPTS): void
  destroy() : void
}

export interface RemuxedTrack {
    data1: Uint8Array
    data2: Uint8Array
    startPTS: number
    endPTS: number
    startDTS: number
    endDTS: number
    type: string
    hasAudio: boolean
    hasVideo: boolean
    nb: number
    transferredData1?: ArrayBuffer
    transferredData2?: ArrayBuffer
}

export interface RemuxedMetadata {
    samples: Uint8Array
}

export interface RemuxerResult {
    audio?: RemuxedTrack
    video?: RemuxedTrack
    text?: RemuxedMetadata
    id3?: RemuxedMetadata
    initSegment?: InitSegmentData
}

export interface InitSegmentData {
    tracks?: TrackSet
    initPTS?: number
}
