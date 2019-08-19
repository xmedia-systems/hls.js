import AAC from './aac-helper';
import MP4 from './mp4-generator';
import Event from '../events';
import { ErrorTypes, ErrorDetails } from '../errors';
import { logger } from '../utils/logger';
import { InitSegmentData, Remuxer, RemuxerResult, RemuxedMetadata, RemuxedTrack } from '../types/remuxer';
import { DemuxedAudioTrack, DemuxedAvcTrack, DemuxedTrack } from '../types/demuxer';
import { TrackSet } from '../types/track';
import { SourceBufferName } from '../types/buffer';

const MAX_SILENT_FRAME_DURATION = 10 * 1000; // 10 seconds
const AAC_SAMPLES_PER_FRAME = 1024;
const MPEG_AUDIO_SAMPLE_PER_FRAME = 1152;

export default class MP4Remuxer implements Remuxer {
  private observer: any;
  private config: any;
  private typeSupported: any;
  private isSafari: boolean = false;
  private ISGenerated: boolean = false;
  private _initPTS!: number;
  private _initDTS!: number;
  private nextAvcDts: number | null = null;
  private nextAudioPts: number | null = null;

  constructor (observer, config, typeSupported, vendor) {
    this.observer = observer;
    this.config = config;
    this.typeSupported = typeSupported;
    const userAgent = navigator.userAgent;
    this.isSafari = !!(vendor && vendor.indexOf('Apple') > -1 && userAgent && !userAgent.match('CriOS'));
    this.ISGenerated = false;
  }

  destroy () {
  }

  resetTimeStamp (defaultTimeStamp) {
    logger.log('[mp4-remuxer]: initPTS & initDTS reset reset');
    this._initPTS = this._initDTS = defaultTimeStamp;
  }

  resetNextTimestamp () {
    logger.log('[mp4-remuxer]: nextAudioPts & nextAvcDts reset');
    this.nextAudioPts = null;
    this.nextAvcDts = null;
  }

  resetInitSegment () {
    logger.log('[mp4-remuxer]: ISGenerated flag reset');
    this.ISGenerated = false;
  }

  remux (audioTrack: DemuxedAudioTrack, videoTrack: DemuxedAvcTrack, id3Track: DemuxedTrack, textTrack: DemuxedTrack, timeOffset, accurateTimeOffset) : RemuxerResult {
    let video;
    let audio;
    let initSegment;
    let text;
    let id3;

    // Allow ID3 and text to remux, even if more audio/video samples are required
    const isAudioContiguous = Number.isFinite(this.nextAudioPts!);
    const isVideoContiguous = Number.isFinite(this.nextAvcDts!);
    if (!isVideoContiguous && this.config.forceKeyFrameOnDiscontinuity) {
      const length = videoTrack.samples.length;
      const dropped = dropSamplesUntilKeyframe(videoTrack);
      if (dropped) {
        logger.warn(`[mp4-remuxer]: Dropped ${dropped} out of ${length} video samples due to a missing keyframe`);
      }
    }

    // If we're remuxing audio and video, wait until we've received enough samples for each track before proceeding.
    // This is done to synchronize the audio and video streams. We know if the current segment will have samples if the "pid"
    // parameter is greater than -1. The pid is set when the PMT is parsed, which contains the tracks list.
    // However, if the initSegment has already been generated, we can remux one track without waiting for the other.
    const hasAudio = audioTrack.pid > -1;
    const hasVideo = videoTrack.pid > -1;
    const enoughAudioSamples = audioTrack.samples.length > 0;
    const enoughVideoSamples = videoTrack.samples.length > 1;
    const canRemuxAvc = (!hasAudio || enoughAudioSamples) && (!hasVideo || enoughVideoSamples) || this.ISGenerated;

    if (canRemuxAvc) {
      if (!this.ISGenerated) {
        initSegment = this.generateIS(audioTrack, videoTrack, timeOffset);
      }

      if (this.ISGenerated) {
        // Purposefully remuxing audio before video, so that remuxVideo can use nextAudioPts, which is calculated in remuxAudio.
        if (enoughAudioSamples) {
          // if initSegment was generated without audio samples, regenerate it again
          if (!audioTrack.samplerate) {
            logger.warn('[mp4-remuxer]: regenerate InitSegment as audio detected');
            initSegment = this.generateIS(audioTrack, videoTrack, timeOffset);
            delete initSegment.video;
          }
          audio = this.remuxAudio(audioTrack, timeOffset, isAudioContiguous, accurateTimeOffset);
          if (enoughVideoSamples) {
            const audioTrackLength = audio ? audio.endPTS - audio.startPTS : 0;
            // if initSegment was generated without video samples, regenerate it again
            if (!videoTrack.inputTimeScale) {
              logger.warn('[mp4-remuxer]: regenerate InitSegment as video detected');
              initSegment = this.generateIS(audioTrack, videoTrack, timeOffset);
            }
            video = this.remuxVideo(videoTrack, timeOffset, isVideoContiguous, audioTrackLength, accurateTimeOffset);
          }
        } else if (enoughVideoSamples) {
          video = this.remuxVideo(videoTrack, timeOffset, isVideoContiguous, 0, accurateTimeOffset);
        }
      }
    }

    if (this.ISGenerated) {
      if (id3Track.samples.length) {
        id3 = this.remuxID3(id3Track);
      }

      if (textTrack.samples.length) {
        text = this.remuxText(textTrack);
      }
    }

    return {
      audio,
      video,
      initSegment,
      text,
      id3
    };
  }

  generateIS (audioTrack: DemuxedAudioTrack, videoTrack: DemuxedAvcTrack, timeOffset) : InitSegmentData | undefined {
    logger.log(`[mp4-remuxer]: generateIS`, Object.assign({}, audioTrack), Object.assign({}, videoTrack), timeOffset);
    const audioSamples = audioTrack.samples;
    const videoSamples = videoTrack.samples;
    const typeSupported = this.typeSupported;
    const tracks = {} as TrackSet;
    const computePTSDTS = (!Number.isFinite(this._initPTS));
    let container = 'audio/mp4';
    let initPTS;
    let initDTS;

    if (computePTSDTS) {
      initPTS = initDTS = Infinity;
    }

    if (audioTrack.config && audioSamples.length) {
      // let's use audio sampling rate as MP4 time scale.
      // rationale is that there is a integer nb of audio frames per audio sample (1024 for AAC)
      // using audio sampling rate here helps having an integer MP4 frame duration
      // this avoids potential rounding issue and AV sync issue
      audioTrack.timescale = audioTrack.samplerate;
      logger.log(`[mp4-remuxer]: audio sampling rate : ${audioTrack.samplerate}`);
      if (!audioTrack.isAAC) {
        if (typeSupported.mpeg) { // Chrome and Safari
          container = 'audio/mpeg';
          audioTrack.codec = '';
        } else if (typeSupported.mp3) { // Firefox
          audioTrack.codec = 'mp3';
        }
      }
      tracks.audio = {
        id: 'audio',
        container: container,
        codec: audioTrack.codec,
        initSegment: !audioTrack.isAAC && typeSupported.mpeg ? new Uint8Array(0) : MP4.initSegment([audioTrack]),
        metadata: {
          channelCount: audioTrack.channelCount
        }
      };
      if (computePTSDTS) {
        // remember first PTS of this demuxing context. for audio, PTS = DTS
        initPTS = initDTS = audioSamples[0].pts - audioTrack.inputTimeScale * timeOffset;
      }
    }

    if (videoTrack.sps && videoTrack.pps && videoSamples.length) {
      // let's use input time scale as MP4 video timescale
      // we use input time scale straight away to avoid rounding issues on frame duration / cts computation
      const inputTimeScale = videoTrack.timescale = videoTrack.inputTimeScale;
      tracks.video = {
        id: 'main',
        container: 'video/mp4',
        codec: videoTrack.codec,
        initSegment: MP4.initSegment([videoTrack]),
        metadata: {
          width: videoTrack.width,
          height: videoTrack.height
        }
      };
      if (computePTSDTS) {
        initPTS = Math.min(initPTS, videoSamples[0].pts - inputTimeScale * timeOffset);
        initDTS = Math.min(initDTS, videoSamples[0].dts - inputTimeScale * timeOffset);
      }
    }

    if (Object.keys(tracks).length) {
      this.ISGenerated = true;
      if (computePTSDTS) {
        this._initPTS = initPTS;
        this._initDTS = initDTS;
      }

      return {
        tracks,
        initPTS
      };
    }
  }

  remuxVideo (track: DemuxedTrack, timeOffset, contiguous, audioTrackLength, accurateTimeOffset) : RemuxedTrack | undefined {
    const timeScale: number = track.inputTimeScale;
    const inputSamples: Array<any> = track.samples;
    const outputSamples: Array<Mp4Sample> = [];
    const nbSamples: number = inputSamples.length;
    const initPTS: number = this._initPTS;
    let nextAvcDts = this.nextAvcDts;
    let offset = 8;
    let mp4SampleDuration!: number;

    // Safari does not like overlapping DTS on consecutive fragments. let's use nextAvcDts to overcome this if fragments are consecutive
    const isSafari: boolean = this.isSafari;
    if (isSafari) {
      // also consider consecutive fragments as being contiguous (even if a level switch occurs),
      // for sake of clarity:
      // consecutive fragments are frags with
      //  - less than 100ms gaps between new time offset (if accurate) and next expected PTS OR
      //  - less than 200 ms PTS gaps (timeScale/5)
      contiguous = contiguous || (inputSamples.length && nextAvcDts &&
                     ((accurateTimeOffset && Math.abs(timeOffset - nextAvcDts / timeScale) < 0.1) ||
                      Math.abs((inputSamples[0].pts - nextAvcDts - initPTS)) < timeScale / 5)
      );
    }
    // if parsed fragment is contiguous with last one, let's use last DTS value as reference
    if (nextAvcDts === null) {
      // if not contiguous, let's use target timeOffset
      this.nextAvcDts = nextAvcDts = timeOffset * timeScale;
      logger.log(`[mp4-remuxer]: nextAvcDts generated as ${nextAvcDts}`);
    }

    // PTS is coded on 33bits, and can loop from -2^32 to 2^32
    // ptsNormalize will make PTS/DTS value monotonic, we use last known DTS value as reference value
    inputSamples.forEach(function (sample) {
      sample.pts = PTSNormalize(sample.pts - initPTS, nextAvcDts);
      sample.dts = PTSNormalize(sample.dts - initPTS, nextAvcDts);
    });

    // Sort video samples by DTS
    inputSamples.sort((a, b) => a.dts - b.dts);

    // handle broken streams with PTS < DTS, tolerance up 200ms (18000 in 90kHz timescale)
    const PTSDTSshift = inputSamples.reduce((prev, curr) => Math.max(Math.min(prev, curr.pts - curr.dts), -18000), 0);
    if (PTSDTSshift < 0) {
      logger.log(`[mp4-remuxer]: PTS < DTS detected in video samples, shifting DTS by ${Math.round(PTSDTSshift / 90)} ms to overcome this issue`);
      for (let i = 0; i < inputSamples.length; i++) {
        inputSamples[i].dts += PTSDTSshift;
      }
    }

    const firstSample = inputSamples[0];
    let firstDTS = Math.max(firstSample.dts, 0);
    // Check timestamp continuity across consecutive fragments, and modify timing in order to remove gaps or overlaps.
    const millisecondDelta = Math.round((firstDTS - nextAvcDts) / 90);
    if (contiguous) {
      if (millisecondDelta) {
        if (millisecondDelta > 1) {
          logger.log(`[mp4-remuxer]: AVC:${millisecondDelta} ms hole between fragments detected,filling it`);
        } else if (millisecondDelta < -1) {
          logger.log(`[mp4-remuxer]: AVC:${(-millisecondDelta)} ms overlapping between fragments detected`);
        }

        // remove hole/gap : set DTS to next expected DTS
        firstSample.dts = firstDTS = nextAvcDts;
        firstSample.pts = Math.max(firstSample.pts - millisecondDelta, nextAvcDts);
        // offset PTS as well, ensure that PTS is smaller or equal than new DTS
        logger.log(`[mp4-remuxer]: Video/PTS/DTS adjusted: ${Math.round(firstSample.pts / 90)}/${Math.round(firstDTS / 90)}, delta:${millisecondDelta} ms`);
      }
    }

    // compute lastPTS/lastDTS
    const lastSample = inputSamples[inputSamples.length - 1];
    const lastDTS = Math.max(lastSample.dts, 0);

    let minPTS = Infinity;
    let maxPTS = 0;
    for (let i = 0; i < inputSamples.length; i++) {
      const sample = inputSamples[i];
      minPTS = Math.min(sample.pts, minPTS);
      maxPTS = Math.max(sample.pts, maxPTS);
    }

    // on Safari let's signal the same sample duration for all samples
    // sample duration (as expected by trun MP4 boxes), should be the delta between sample DTS
    // set this constant duration as being the avg delta between consecutive DTS.
    if (isSafari) {
      mp4SampleDuration = Math.round((lastDTS - firstDTS) / (inputSamples.length - 1));
    }

    let nbNalu = 0;
    let naluLen = 0;
    for (let i = 0; i < nbSamples; i++) {
      // compute total/avc sample length and nb of NAL units
      const sample = inputSamples[i];
      const units = sample.units;
      const nbUnits = units.length;
      let sampleLen = 0;
      for (let j = 0; j < nbUnits; j++) {
        sampleLen += units[j].data.length;
      }

      naluLen += sampleLen;
      nbNalu += nbUnits;
      sample.length = sampleLen;

      // normalize PTS/DTS
      if (isSafari) {
        // sample DTS is computed using a constant decoding offset (mp4SampleDuration) between samples
        sample.dts = firstDTS + i * mp4SampleDuration;
      } else {
        // ensure sample monotonic DTS
        sample.dts = Math.max(sample.dts, firstDTS);
      }
      // ensure that computed value is greater or equal than sample DTS
      sample.pts = Math.max(sample.pts, sample.dts);
    }

    /* concatenate the video data and construct the mdat in place
      (need 8 more bytes to fill length and mpdat type) */
    const mdatSize = naluLen + (4 * nbNalu) + 8;
    let mdat;
    try {
      mdat = new Uint8Array(mdatSize);
    } catch (err) {
      this.observer.trigger(Event.ERROR, { type: ErrorTypes.MUX_ERROR, details: ErrorDetails.REMUX_ALLOC_ERROR, fatal: false, bytes: mdatSize, reason: `fail allocating video mdat ${mdatSize}` });
      return;
    }
    let view = new DataView(mdat.buffer);
    view.setUint32(0, mdatSize);
    mdat.set(MP4.types.mdat, 4);

    for (let i = 0; i < nbSamples; i++) {
      const avcSample = inputSamples[i];
      const avcSampleUnits = avcSample.units;
      let mp4SampleLength = 0;
      let compositionTimeOffset;
      // convert NALU bitstream to MP4 format (prepend NALU with size field)
      for (let j = 0, nbUnits = avcSampleUnits.length; j < nbUnits; j++) {
        const unit = avcSampleUnits[j];
        const unitData = unit.data;
        const unitDataLen = unit.data.byteLength;
        view.setUint32(offset, unitDataLen);
        offset += 4;
        mdat.set(unitData, offset);
        offset += unitDataLen;
        mp4SampleLength += 4 + unitDataLen;
      }

      if (!isSafari) {
        // expected sample duration is the Decoding Timestamp diff of consecutive samples
        if (i < nbSamples - 1) {
          mp4SampleDuration = inputSamples[i + 1].dts - avcSample.dts;
        } else {
          let config = this.config,
            lastFrameDuration = avcSample.dts - inputSamples[i > 0 ? i - 1 : i].dts;
          if (config.stretchShortVideoTrack && this.nextAudioPts !== null) {
            // In some cases, a segment's audio track duration may exceed the video track duration.
            // Since we've already remuxed audio, and we know how long the audio track is, we look to
            // see if the delta to the next segment is longer than maxBufferHole.
            // If so, playback would potentially get stuck, so we artificially inflate
            // the duration of the last frame to minimize any potential gap between segments.
            const gapTolerance = Math.floor(config.maxBufferHole * timeScale);
            const deltaToFrameEnd = (audioTrackLength ? minPTS + audioTrackLength * timeScale : this.nextAudioPts) - avcSample.pts;
            if (deltaToFrameEnd > gapTolerance) {
              // We subtract lastFrameDuration from deltaToFrameEnd to try to prevent any video
              // frame overlap. maxBufferHole should be >> lastFrameDuration anyway.
              mp4SampleDuration = deltaToFrameEnd - lastFrameDuration;
              if (mp4SampleDuration < 0) {
                mp4SampleDuration = lastFrameDuration;
              }
              logger.log(`[mp4-remuxer]: It is approximately ${deltaToFrameEnd / 90} ms to the next segment; using duration ${mp4SampleDuration / 90} ms for the last video frame.`);
            } else {
              mp4SampleDuration = lastFrameDuration;
            }
          } else {
            mp4SampleDuration = lastFrameDuration;
          }
        }
        compositionTimeOffset = Math.round(avcSample.pts - avcSample.dts);
      } else {
        compositionTimeOffset = Math.max(0, mp4SampleDuration * Math.round((avcSample.pts - avcSample.dts) / mp4SampleDuration));
      }

      outputSamples.push(new Mp4Sample(avcSample.key, mp4SampleDuration, mp4SampleLength, compositionTimeOffset));
    }

    console.assert(mp4SampleDuration !== undefined, 'mp4SampleDuration must be computed');
    // next AVC sample DTS should be equal to last sample DTS + last sample duration (in PES timescale)
    this.nextAvcDts = nextAvcDts = lastDTS + mp4SampleDuration;
    track.samples = outputSamples;
    const moof = MP4.moof(track.sequenceNumber++, firstDTS, track);
    const type: SourceBufferName = 'video';
    const data = {
      data1: moof,
      data2: mdat,
      startPTS: minPTS / timeScale,
      endPTS: (maxPTS + mp4SampleDuration) / timeScale,
      startDTS: firstDTS / timeScale,
      endDTS: nextAvcDts / timeScale,
      type,
      hasAudio: false,
      hasVideo: true,
      nb: outputSamples.length,
      dropped: track.dropped
    };

    track.samples = [];
    track.dropped = 0;

    console.assert(mdat.length, 'MDAT length must not be zero');

    return data;
  }

  remuxAudio (track, timeOffset: number, contiguous: boolean, accurateTimeOffset: boolean): RemuxedTrack | undefined {
    const inputTimeScale: number = track.inputTimeScale;
    const mp4timeScale: number = track.samplerate;
    const scaleFactor: number = inputTimeScale / mp4timeScale;
    const mp4SampleDuration: number = track.isAAC ? AAC_SAMPLES_PER_FRAME : MPEG_AUDIO_SAMPLE_PER_FRAME;
    const inputSampleDuration: number = mp4SampleDuration * scaleFactor;
    const initPTS: number = this._initPTS;
    const rawMPEG: boolean = !track.isAAC && this.typeSupported.mpeg;
    const outputSamples: Array<Mp4Sample> = [];

    let inputSamples: Array<any> = track.samples;
    let offset: number = rawMPEG ? 0 : 8;
    let fillFrame: any;
    let nextAudioPts = this.nextAudioPts;

    // window.audioSamples ? window.audioSamples.push(inputSamples.map(s => s.pts)) : (window.audioSamples = [inputSamples.map(s => s.pts)]);

    // for audio samples, also consider consecutive fragments as being contiguous (even if a level switch occurs),
    // for sake of clarity:
    // consecutive fragments are frags with
    //  - less than 100ms gaps between new time offset (if accurate) and next expected PTS OR
    //  - less than 20 audio frames distance
    // contiguous fragments are consecutive fragments from same quality level (same level, new SN = old SN + 1)
    // this helps ensuring audio continuity
    // and this also avoids audio glitches/cut when switching quality, or reporting wrong duration on first audio frame
    contiguous = contiguous || (inputSamples.length && nextAudioPts &&
                   ((accurateTimeOffset && Math.abs(timeOffset - nextAudioPts / inputTimeScale) < 0.1) ||
                    Math.abs((inputSamples[0].pts - nextAudioPts - initPTS)) < 20 * inputSampleDuration)
    ) as boolean;

    // compute normalized PTS
    inputSamples.forEach(function (sample) {
      sample.pts = sample.dts = PTSNormalize(sample.pts - initPTS, timeOffset * inputTimeScale);
    });

    // filter out sample with negative PTS that are not playable anyway
    // if we don't remove these negative samples, they will shift all audio samples forward.
    // leading to audio overlap between current / next fragment
    inputSamples = inputSamples.filter(function (sample) {
      return sample.pts >= 0;
    });

    // in case all samples have negative PTS, and have been filtered out, return now
    if (!inputSamples.length) {
      return;
    }

    if (nextAudioPts === null) {
      this.nextAudioPts = nextAudioPts = accurateTimeOffset ? timeOffset * inputTimeScale : inputSamples[0].pts as number;
      logger.log(`[mp4-remuxer]: nextAudioPts generated as ${nextAudioPts}`);
    }

    // If the audio track is missing samples, the frames seem to get "left-shifted" within the
    // resulting mp4 segment, causing sync issues and leaving gaps at the end of the audio segment.
    // In an effort to prevent this from happening, we inject frames here where there are gaps.
    // When possible, we inject a silent frame; when that's not possible, we duplicate the last
    // frame.

    if (track.isAAC) {
      const maxAudioFramesDrift = this.config.maxAudioFramesDrift;
      for (let i = 0, nextPts = nextAudioPts; i < inputSamples.length;) {
        // First, let's see how far off this frame is from where we expect it to be
        const sample = inputSamples[i];
        const pts = sample.pts;
        const delta = pts - nextPts;

        const duration = Math.abs(1000 * delta / inputTimeScale);

        // If we're overlapping by more than a duration, drop this sample
        if (delta <= -maxAudioFramesDrift * inputSampleDuration) {
          logger.warn(`[mp4-remuxer]: Dropping 1 audio frame @ ${(nextPts / inputTimeScale).toFixed(3)}s due to ${Math.round(duration)} ms overlap.`);
          inputSamples.splice(i, 1);
          // Don't touch nextPtsNorm or i
        } // eslint-disable-line brace-style

        // Insert missing frames if:
        // 1: We're more than maxAudioFramesDrift frame away
        // 2: Not more than MAX_SILENT_FRAME_DURATION away
        // 3: currentTime (aka nextPtsNorm) is not 0
        else if (delta >= maxAudioFramesDrift * inputSampleDuration && duration < MAX_SILENT_FRAME_DURATION && nextPts) {
          let missing = Math.round(delta / inputSampleDuration);
          logger.warn(`[mp4-remuxer]: Injecting ${missing} audio frame @ ${(nextPts / inputTimeScale).toFixed(3)}s due to ${Math.round(1000 * delta / inputTimeScale)} ms gap.`);
          for (let j = 0; j < missing; j++) {
            let newStamp = Math.max(nextPts, 0);
            fillFrame = AAC.getSilentFrame(track.manifestCodec || track.codec, track.channelCount);
            if (!fillFrame) {
              logger.log('[mp4-remuxer]: Unable to get silent frame for given audio codec; duplicating last frame instead.');
              fillFrame = sample.unit.subarray();
            }
            inputSamples.splice(i, 0, { unit: fillFrame, pts: newStamp, dts: newStamp });
            nextPts += inputSampleDuration;
            i++;
          }

          // Adjust sample to next expected pts
          sample.pts = sample.dts = nextPts;
          nextPts += inputSampleDuration;
          i++;
        } else {
        // Otherwise, just adjust pts
          sample.pts = sample.dts = nextPts;
          nextPts += inputSampleDuration;
          i++;
        }
      }
    }
    let firstPTS: number | null = null;
    let lastPTS: number | null = null;
    let mdat: any;
    let mdatSize: number = 0;
    let sampleLength: number = inputSamples.length;
    while (sampleLength--) {
      mdatSize += inputSamples[sampleLength].unit.byteLength;
    }
    for (let j = 0, nbSamples = inputSamples.length; j < nbSamples; j++) {
      let audioSample = inputSamples[j];
      let unit = audioSample.unit;
      let pts = audioSample.pts;
      if (lastPTS !== null) {
        // If we have more than one sample, set the duration of the sample to the "real" duration; the PTS diff with
        // the previous sample
        const prevSample = outputSamples[j - 1];
        prevSample.duration = Math.round((pts - lastPTS) / scaleFactor);
      } else {
        let delta = Math.round(1000 * (pts - nextAudioPts) / inputTimeScale),
          numMissingFrames = 0;
        // if fragment are contiguous, detect hole/overlapping between fragments
        // contiguous fragments are consecutive fragments from same quality level (same level, new SN = old SN + 1)
        if (contiguous && track.isAAC) {
          if (delta > 0 && delta < MAX_SILENT_FRAME_DURATION) {
            numMissingFrames = Math.round((pts - nextAudioPts) / inputSampleDuration);
            logger.log(`[mp4-remuxer]: ${delta} ms hole between AAC samples detected,filling it`);
            if (numMissingFrames > 0) {
              fillFrame = AAC.getSilentFrame(track.manifestCodec || track.codec, track.channelCount);
              if (!fillFrame) {
                fillFrame = unit.subarray();
              }

              mdatSize += numMissingFrames * fillFrame.length;
            }
            // if we have frame overlap, overlapping for more than half a frame duraion
          } else if (delta < -12) {
            // drop overlapping audio frames... browser will deal with it
            logger.log(`[mp4-remuxer]: drop overlapping AAC sample, expected/parsed/delta:${(nextAudioPts / inputTimeScale).toFixed(3)}s/${(pts / inputTimeScale).toFixed(3)}s/${(-delta)}ms`);
            mdatSize -= unit.byteLength;
            continue;
          }
          // set PTS/DTS to expected PTS/DTS
          pts = nextAudioPts;
        }
        // remember first PTS of our audioSamples
        firstPTS = pts;
        if (mdatSize > 0) {
          /* concatenate the audio data and construct the mdat in place
            (need 8 more bytes to fill length and mdat type) */
         mdatSize += offset;
          try {
            mdat = new Uint8Array(mdatSize);
          } catch (err) {
            this.observer.trigger(Event.ERROR, {
              type: ErrorTypes.MUX_ERROR,
              details: ErrorDetails.REMUX_ALLOC_ERROR,
              fatal: false,
              bytes: mdatSize,
              reason: `fail allocating audio mdat ${mdatSize}`
            });
            return;
          }
          if (!rawMPEG) {
            const view = new DataView(mdat.buffer);
            view.setUint32(0, mdatSize);
            mdat.set(MP4.types.mdat, 4);
          }
        } else {
          // no audio samples
          return;
        }
        for (let i = 0; i < numMissingFrames; i++) {
          fillFrame = AAC.getSilentFrame(track.manifestCodec || track.codec, track.channelCount);
          if (!fillFrame) {
            logger.log('[mp4-remuxer]: Unable to get silent frame for given audio codec; duplicating the current frame instead');
            fillFrame = unit.subarray();
          }
          mdat.set(fillFrame, offset);
          offset += fillFrame.byteLength;
          outputSamples.push(new Mp4Sample(true, AAC_SAMPLES_PER_FRAME, fillFrame.byteLength, 0));
        }
      }
      mdat.set(unit, offset);
      const unitLen = unit.byteLength;
      offset += unitLen;
      // Default the sample's duration to the computed mp4SampleDuration, which will either be 1024 for AAC or 1152 for MPEG
      // In the case that we have 1 sample, this will be the duration. If we have more than one sample, the duration
      // becomes the PTS diff with the previous sample
      outputSamples.push(new Mp4Sample(true, mp4SampleDuration, unitLen, 0));
      lastPTS = pts;
    }

    // We could end up with no audio samples if all input samples were overlapping with the previously remuxed ones
    const nbSamples = outputSamples.length;
    if (!nbSamples) {
      return;
    }

    // The next audio sample PTS should be equal to last sample PTS + duration
    const lastSample = outputSamples[outputSamples.length - 1];
    this.nextAudioPts = nextAudioPts = lastPTS! + scaleFactor * lastSample.duration;

    // Set the track samples from inputSamples to outputSamples before remuxing
    // TODO: Pass in as another arg so that the samples array can be of one type
    track.samples = outputSamples;
    const moof = rawMPEG ? new Uint8Array(0) : MP4.moof(track.sequenceNumber++, firstPTS! / scaleFactor, track);

    // Clear the track samples. This also clears the samples array in the demuxer, since the reference is shared
    track.samples = [];
    const start = firstPTS! / inputTimeScale;
    const end = nextAudioPts / inputTimeScale;
    const type: SourceBufferName = 'audio';
    const audioData = {
      data1: moof,
      data2: mdat,
      startPTS: start,
      endPTS: end,
      startDTS: start,
      endDTS: end,
      type,
      hasAudio: true,
      hasVideo: false,
      nb: nbSamples
    };

    console.assert(mdat.length, 'MDAT length must not be zero');
    return audioData;
  }

  remuxEmptyAudio (track, timeOffset, contiguous, videoData) : RemuxedTrack | undefined {
    const inputTimeScale = track.inputTimeScale;
    const mp4timeScale = track.samplerate ? track.samplerate : inputTimeScale;
    const scaleFactor = inputTimeScale / mp4timeScale;
    const nextAudioPts = this.nextAudioPts;
    // sync with video's timestamp
    const startDTS = (nextAudioPts !== null ? nextAudioPts : videoData.startDTS * inputTimeScale) + this._initDTS;
    const endDTS = videoData.endDTS * inputTimeScale + this._initDTS;
    // one sample's duration value
    const frameDuration = scaleFactor * AAC_SAMPLES_PER_FRAME;
    // samples count of this segment's duration
    const nbSamples = Math.ceil((endDTS - startDTS) / frameDuration);
    // silent frame
    const silentFrame = AAC.getSilentFrame(track.manifestCodec || track.codec, track.channelCount);

    logger.warn('[mp4-remuxer]: remux empty Audio');
    // Can't remux if we can't generate a silent frame...
    if (!silentFrame) {
      logger.trace('[mp4-remuxer]: Unable to remuxEmptyAudio since we were unable to get a silent frame for given audio codec');
      return;
    }

    let samples = [] as Array<any>;
    for (let i = 0; i < nbSamples; i++) {
      let stamp = startDTS + i * frameDuration;
      samples.push({ unit: silentFrame, pts: stamp, dts: stamp });
    }
    track.samples = samples;

    return this.remuxAudio(track, timeOffset, contiguous, false);
  }

  remuxID3 (track) : RemuxedMetadata | undefined {
    const length = track.samples.length;
    if (!length) {
      return;
    }
    const inputTimeScale = track.inputTimeScale;
    const initPTS = this._initPTS;
    const initDTS = this._initDTS;
    for (let index = 0; index < length; index++) {
      let sample = track.samples[index];
      // setting id3 pts, dts to relative time
      // using this._initPTS and this._initDTS to calculate relative time
      sample.pts = ((sample.pts - initPTS) / inputTimeScale);
      sample.dts = ((sample.dts - initDTS) / inputTimeScale);
    }
    const samples = track.samples;
    track.samples = [];
    return {
      samples
    };
  }

  remuxText (track) : RemuxedMetadata | undefined {
    const length = track.samples.length;
    if (!length) {
      return;
    }
    track.samples.sort((a, b) => a.pts - b.pts);

    const inputTimeScale = track.inputTimeScale;
    const initPTS = this._initPTS;
    for (let index = 0; index < length; index++) {
      let sample = track.samples[index];
      // setting text pts, dts to relative time
      // using this._initPTS and this._initDTS to calculate relative time
      sample.pts = ((sample.pts - initPTS) / inputTimeScale);
    }
    const samples = track.samples;
    track.samples = [];
    return {
      samples
    };
  }
}

function PTSNormalize (value: number, reference: number | null): number {
  let offset;
  if (reference === null) {
    return value;
  }

  if (reference < value) {
    // - 2^33
    offset = -8589934592;
  } else {
    // + 2^33
    offset = 8589934592;
  }
  /* PTS is 33bit (from 0 to 2^33 -1)
    if diff between value and reference is bigger than half of the amplitude (2^32) then it means that
    PTS looping occured. fill the gap */
  while (Math.abs(value - reference) > 4294967296) {
    value += offset;
  }

  return value;
}

function dropSamplesUntilKeyframe (track: DemuxedTrack) : number {
  const samples = track.samples;
  let dropIndex = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (sample.key) {
      break;
    }
    dropIndex++;
  }
  if (dropIndex) {
    track.samples = samples.slice(dropIndex);
    track.dropped += dropIndex;
  }
  return dropIndex;
}


class Mp4Sample {
  public size: number;
  public duration: number;
  public cts: number;
  public flags: Mp4SampleFlags;

  constructor (isKeyframe: boolean, duration, size, cts) {
    this.duration = duration;
    this.size = size;
    this.cts = cts;
    this.flags = new Mp4SampleFlags(isKeyframe);
  }
}

class Mp4SampleFlags {
  public isLeading: 0 = 0;
  public isDependedOn: 0 = 0;
  public hasRedundancy: 0 = 0;
  public degradPrio: 0 = 0;
  public dependsOn: 1|2 = 1;
  public isNonSync: 0|1 = 1;

  constructor (isKeyframe) {
    this.dependsOn = isKeyframe ? 2 : 1;
    this.isNonSync = isKeyframe ? 0 : 1
  }
}