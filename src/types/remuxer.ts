import { TrackSet } from './track';
import { DemuxedAudioTrack, DemuxedAvcTrack, DemuxedTrack } from './demuxer';
import { SourceBufferName } from './buffer';

export interface Remuxer {
  remux(audioTrack: DemuxedAudioTrack,
        videoTrack: DemuxedAvcTrack,
        id3Track: DemuxedTrack,
        textTrack: DemuxedTrack,
        timeOffset: number,
        accurateTimeOffset: boolean
  ): RemuxerResult
  resetInitSegment(initSegment: Uint8Array, audioCodec: string, videoCodec: string): void
  resetTimeStamp(defaultInitPTS): void
  resetNextTimestamp() : void
  destroy() : void
}

export interface RemuxedTrack {
    data1: Uint8Array
    data2?: Uint8Array
    startPTS: number
    endPTS: number
    startDTS: number
    endDTS: number
    type: SourceBufferName
    hasAudio: boolean
    hasVideo: boolean
    nb: number
    transferredData1?: ArrayBuffer
    transferredData2?: ArrayBuffer
    dropped?: number
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
