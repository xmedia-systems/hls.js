import { RemuxedTrack, Remuxer, RemuxerResult } from '../types/remuxer';

class PassThroughRemuxer implements Remuxer {
  destroy () {
  }

  resetTimeStamp () {
  }

  resetInitSegment () {
  }

  remux (audioTrack, videoTrack, id3Track, textTrack, timeOffset, contiguous, accurateTimeOffset, rawData): RemuxerResult {
    let audio;
    let video;
    if (audioTrack) {
      audio = {
        data1: rawData,
        startPTS: timeOffset,
        startDTS: timeOffset,
        type: 'audio',
        hasAudio: !!audioTrack,
        hasVideo: !!videoTrack,
        nb: 1,
        dropped: 0
      } as RemuxedTrack;
    }

    if (videoTrack) {
      video = {
        data1: rawData,
        startPTS: timeOffset,
        startDTS: timeOffset,
        type: 'video',
        hasAudio: !!audioTrack,
        hasVideo: !!videoTrack,
        nb: 1,
        dropped: 0
      } as RemuxedTrack;
    }

    return {
      audio,
      video,
      text: textTrack,
      id3: id3Track
    };
  }
}

export default PassThroughRemuxer;
