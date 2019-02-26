/**
 * MP4 demuxer
 */
import { logger } from '../utils/logger';
import { Demuxer, DemuxerResult, DemuxedTrack } from '../types/demuxer';
import { findBox, segmentValidRange, prependUint8Array, getDuration } from '../utils/mp4-tools';

class MP4Demuxer implements Demuxer {
  private remainderData: Uint8Array | null = null;

  resetTimeStamp () {
  }

  resetInitSegment () {
  }

  static probe (data) {
    // ensure we find a moof box in the first 16 kB
    return findBox({ data: data, start: 0, end: Math.min(data.length, 16384) }, ['moof']).length > 0;
  }

  demux (data, timeOffset, contiguous, accurateTimeOffset): DemuxerResult {
    // Load all data into the avc track. The CMAF remuxer will look for the data in the samples object; the rest of the fields do not matter
    let avcSamples = data;
    if (this.remainderData) {
      // avcSamples = prependUint8Array(data, this.remainderData);
    }
    const avcTrack = dummyTrack();
    const segmentedData = segmentValidRange(avcSamples);
    this.remainderData = segmentedData.remainder;
    avcTrack.samples = data;

    return {
      audioTrack: dummyTrack(),
      avcTrack,
      id3Track: dummyTrack(),
      textTrack: dummyTrack()
    };
  }

  flush() {
    const avcTrack: DemuxedTrack = dummyTrack();
    avcTrack.samples = this.remainderData;

    return {
        audioTrack: dummyTrack(),
        avcTrack,
        id3Track: dummyTrack(),
        textTrack: dummyTrack()
    };
  }

  demuxSampleAes (data: Uint8Array, decryptData: Uint8Array, timeOffset: number, contiguous: boolean): Promise<DemuxerResult> {
    return Promise.reject(new Error('The MP4 demuxer does not support SAMPLE-AES decryption'));
  }

  destroy () {}
}

const dummyTrack = () => ({ type: '', id: -1, pid: -1, inputTimeScale: 90000, sequenceNumber: -1, len: 0, samples: [] });

export default MP4Demuxer;
