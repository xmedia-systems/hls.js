import { TrackSet } from './track';

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
