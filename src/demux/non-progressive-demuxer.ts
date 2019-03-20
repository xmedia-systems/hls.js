import { Demuxer, DemuxerResult } from '../types/demuxer';

const dummyTrack = () => ({ type: '', id: -1, pid: -1, inputTimeScale: 90000, sequenceNumber: -1, len: 0, samples: [] });
const dummyDemuxResult: DemuxerResult = {
  audioTrack: dummyTrack(),
  avcTrack: dummyTrack(),
  id3Track: dummyTrack(),
  textTrack: dummyTrack()
};

export default class NonProgressiveDemuxer implements Demuxer {
  private _chunks: Array<Uint8Array> = [];
  private _dataLength: number = 0;
  private _contiguous: boolean = false;
  private _timeOffset: number = 0;
  private _isSampleAes: boolean = false;

  demux (data: Uint8Array, timeOffset: number, contiguous: boolean, isSampleAes?: boolean): DemuxerResult {
    this._contiguous = contiguous;
    this._timeOffset = timeOffset;
    this._isSampleAes = !!isSampleAes;
    this._dataLength += data.length;
    this._chunks.push(data);

    return dummyDemuxResult;
  }

  demuxSampleAes (data: Uint8Array, decryptData: Uint8Array, timeOffset: number, contiguous: boolean): Promise<DemuxerResult> {
    return undefined;
  }

  destroy (): void {
  }

  flush (): DemuxerResult {
    const { _chunks, _dataLength, _timeOffset, _contiguous, _isSampleAes } = this;
    const data = concatChunks(_chunks, _dataLength);
    const result = this.demuxInternal(data, _timeOffset, _contiguous, _isSampleAes);
    this.reset();

    return result;
  }

  resetInitSegment (initSegment: Uint8Array, audioCodec: string, videoCodec: string, duration: number) {
    this.reset();
  }

  resetTimeStamp (defaultInitPTS): void {
  }

  protected demuxInternal (data: Uint8Array, timeOffset: number, contiguous: boolean, isSampleAes?: boolean) : DemuxerResult {}

  private reset () {
    this._chunks = [];
    this._dataLength = 0;
    this._timeOffset = 0;
    this._contiguous = false;
    this._isSampleAes = false;
  }
}

function concatChunks (chunks: Array<Uint8Array>, dataLength: number) : Uint8Array {
  const result = new Uint8Array(dataLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}