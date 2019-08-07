import { DemuxedTrack } from '../types/demuxer';

export const dummyTrack: DemuxedTrack = Object.freeze({
  type: '',
  id: -1,
  pid: -1,
  inputTimeScale: 90000,
  sequenceNumber: -1,
  samples: [],
  dropped: 0
});
