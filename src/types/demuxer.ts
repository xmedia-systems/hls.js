import { InitSegmentData, RemuxerResult } from './remuxer';

export interface Demuxer {
  demux (data: Uint8Array, timeOffset: number, contiguous: boolean, isSampleAes?: boolean) : DemuxerResult
  demuxSampleAes (data: Uint8Array, decryptData: Uint8Array, timeOffset: number, contiguous: boolean) : Promise<DemuxerResult>
  destroy() : void
  resetInitSegment(audioCodec: string, videoCodec: string, duration: number, initSegment?: any);
  resetTimeStamp(defaultInitPTS): void
}

export interface DemuxerResult {
  audioTrack: DemuxedAudioTrack
  avcTrack: DemuxedAvcTrack
  id3Track: DemuxedTrack
  textTrack: DemuxedTrack
}

export interface DemuxedTrack {
  type: string
  id: number
  pid: number
  inputTimeScale: number
  sequenceNumber: number
  samples: any
  len: number,
  container?: string
  dropped?: number
  duration?: number
  pesData?: ElementaryStreamData | null
  codec?: string
}

export interface DemuxedAudioTrack extends DemuxedTrack {
  config?: Array<number>
  samplerate?: number
  isAAC?: boolean
  channelCount?: number
}

export interface DemuxedAvcTrack extends DemuxedTrack {
  width?: number
  height?: number
  pixelRatio?: number
  audFound?: boolean
  pps?: Array<number>
  sps?: Array<number>
  naluState?: number
}

export interface ElementaryStreamData {
  data: Array<number>
  size: number
}
