import { InitSegmentData, RemuxedTrack, Remuxer, RemuxerResult } from '../types/remuxer';
import { getDuration, getStartDTS, offsetStartDTS, parseInitSegment } from '../utils/mp4-tools';
import { TrackSet } from '../types/track';

class PassThroughRemuxer implements Remuxer {
  private emitInitSegment: boolean = false;
  private audioCodec?: string;
  private videoCodec?: string;
  private initData?: any;
  private initPTS?: number;
  private initTracks?: TrackSet;

  destroy () {
  }

  resetTimeStamp (defaultInitPTS) {
    this.initPTS = defaultInitPTS;
  }

  resetInitSegment (initSegment, audioCodec, videoCodec) {
    this.audioCodec = audioCodec;
    this.videoCodec = videoCodec;
    this.generateInitSegment(initSegment);
    this.emitInitSegment = true;
  }

  generateInitSegment (initSegment): void {
    let { audioCodec, videoCodec } = this;
    if (!initSegment || !initSegment.byteLength) {
      this.initTracks = undefined;
      this.initData = undefined;
      return;
    }
    const initData = this.initData = parseInitSegment(initSegment) as any;

    // default audio codec if nothing specified
    // TODO : extract that from initsegment
    if (!audioCodec) {
      audioCodec = 'mp4a.40.5';
    }

    if (!videoCodec) {
      videoCodec = 'avc1.42e01e';
    }

    const tracks = {} as TrackSet;
    if (initData.audio && initData.video) {
      tracks.audiovideo = {
        container: 'video/mp4',
        codec: audioCodec + ',' + videoCodec,
        initSegment
      };
    } else {
      if (initData.audio) {
        tracks.audio = { container: 'audio/mp4', codec: audioCodec, initSegment };
      }

      if (initData.video) {
        tracks.video = { container: 'video/mp4', codec: videoCodec, initSegment };
      }
    }
    this.initTracks = tracks;
  }

  remux (audioTrack, videoTrack, id3Track, textTrack, timeOffset, contiguous, accurateTimeOffset): RemuxerResult {
    const data = videoTrack.samples;
    let initData = this.initData;
    const initSegment = {} as InitSegmentData;
    if (!initData) {
      this.generateInitSegment(data);
      initData = this.initData;
    }

    let startDTS = timeOffset;
    let initPTS = this.initPTS;
    if (!Number.isFinite(initPTS as number)) {
      let startDTS = getStartDTS(initData, data);
      this.initPTS = initPTS = startDTS - timeOffset;
      initSegment.initPTS = initPTS;
    }
    offsetStartDTS(initData, data, initPTS);

    if (this.emitInitSegment) {
      initSegment.tracks = this.initTracks;
      this.emitInitSegment = false;
    }

    const duration = getDuration(data, initData);
    const endDTS = duration + startDTS;

    let track = {
      data1: data,
      startPTS: startDTS,
      startDTS,
      endPTS: endDTS,
      endDTS,
      type: '',
      hasAudio: !!audioTrack,
      hasVideo: !!videoTrack,
      nb: 1,
      dropped: 0
    } as RemuxedTrack;

    if (initData.audio) {
      track.type += 'audio';
    }

    if (initData.video) {
      track.type += 'video';
    }

    return {
      audio: track.type === 'audio' ? track : undefined,
      video: track.type !== 'audio' ? track : undefined,
      text: textTrack,
      id3: id3Track,
      initSegment
    };
  }
}

export default PassThroughRemuxer;
