import { LoaderStats } from '../../src/types/loader';
import Fragment from '../../src/loader/fragment';
import LevelMeasurement from './LevelMeasurement';
import { Level } from '../../src/types/level';
import level from '../../../media-lighthouse/src/hls/level';

const Hls = window.Hls;
const Events = Hls.Events;
// const {
//   MEDIA_ATTACHING,
//   MEDIA_ATTACHED,
//   MEDIA_DETACHED,
//   MANIFEST_LOADING,
//   MANIFEST_LOADED,
//   MANIFEST_PARSED,
//   LEVEL_SWITCHING,
//   LEVEL_SWITCHED,
//   LEVEL_LOADED,
//   LEVEL_UPDATED,
//   LEVEL_PTS_UPDATED,
//   FRAG_CHANGED,
//   LEVEL_SWITCHED,
//   FRAG_PARSING_METADATA,
//   BUFFER_APPENDING,
//   BUFFER_APPENDED,
//   BUFFER_CODECS,
//   FRAG_BUFFERED,
//   INIT_PTS_FOUND,
//   KEY_LOADING,
//   SUBTITLE_TRACKS_UPDATED,
//   NON_NATIVE_TEXT_TRACKS_FOUND,
//   CUES_PARSED,
//   AUDIO_TRACKS_UPDATED,
//   ERROR
// } = Hls.Events;

const setupEvents = [
  Events.MEDIA_ATTACHING,
  Events.MEDIA_ATTACHED,
  Events.MANIFEST_LOADING,
  Events.MANIFEST_LOADED,
  Events.MANIFEST_PARSED,
  Events.BUFFER_CODECS,
  Events.BUFFER_CREATED
];

const playlistEvents = [
  Events.LEVEL_LOADING,
  Events.LEVEL_LOADED,
  Events.LEVEL_UPDATED,
  Events.LEVEL_SWITCHING,
  Events.LEVEL_SWITCHED,
  Events.AUDIO_TRACK_LOADING,
  Events.AUDIO_TRACK_LOADED,
  Events.AUDIO_TRACK_SWITCHING,
  Events.AUDIO_TRACK_SWITCHED,
  // TODO: subtitles
];

const fragLifecycleEvents = [
  Events.FRAG_LOADING,
  Events.FRAG_LOAD_PROGRESS,
  Events.FRAG_LOADED,
  Events.FRAG_PARSING,
  Events.FRAG_PARSED,
  // Events.BUFFER_APPENDING,
  // Events.BUFFER_APPENDED,
  Events.FRAG_BUFFERED
];

const measuredEvents = [...setupEvents, ...playlistEvents, ...fragLifecycleEvents];

const setupTimeMeasurement = {
  name: 'Setup',
  eventFrom: Events.MEDIA_ATTACHING,
  eventTo: Events.BUFFER_CREATED
};

class PerformanceAnalyzer {
  private hls: any;
  private mediaElement: HTMLMediaElement;
  private listeners: HlsListener[];
  private levelAnalyzers: LevelMeasurement[] = [];

  constructor (hls, mediaElement) {
    this.hls = hls;
    this.mediaElement = mediaElement;
    this.listeners = this.createListeners();
  }

  setup () {
    const { hls, listeners, mediaElement } = this;

    listeners.forEach(l => {
      hls.on(l.name, l.fn);
    });

    hls.loadSource('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
    hls.attachMedia(mediaElement);
  }

  destroy () {
    const { hls, listeners } = this;
    listeners.forEach(l => {
      hls.off(l.name, l.fn);
    });
  }

  private createListeners (): HlsListener[] {
    const advancedListeners = [
      { name: Events.MANIFEST_PARSED, fn: this.onManifestParsed.bind(this) },
      { name: Events.FRAG_BUFFERED, fn: this.onFragBuffered.bind(this) }
    ];

    const simpleListeners = measuredEvents.map(event => ({
      name: event,
      fn: () => {
        performance.mark(event);
      }
    }));

    return [...simpleListeners, ...advancedListeners];
  }

  private onManifestParsed (e, data: { levels: Level[] }) {
    const { mediaElement } = this;

    data.levels.forEach((level, i) => {
      this.levelAnalyzers.push(new LevelMeasurement(level, i));
    });

    mediaElement.play();
    this.measure(Events.MEDIA_ATTACHED, Events.MANIFEST_PARSED);
  }

  private onFragBuffered (e: string, data: { frag: Fragment, stats: LoaderStats }) {
    const { frag, stats } = data;
    const tLoad = stats.loading.end - stats.loading.start;
    const tBuffer = stats.buffering.end - stats.buffering.start;
    const tParse = stats.parsing.end - stats.parsing.start;
    const tTotal = stats.buffering.end - stats.loading.start;

    console.log(`Fragment Stats:
      Level: ${frag.level}
      SN: ${frag.sn}
      Size: ${((stats.total / 1024)).toFixed(3)} kB
      Chunk Count: ${stats.chunkCount}
      Load time: ${tLoad.toFixed(3)} ms
      First Byte Delay: ${(stats.loading.firstByte - stats.loading.start).toFixed(3)} ms
      Parse Time: ${(tParse).toFixed(3)} ms
      Cumulative Transmux Time: ${(stats.parsing.cumulative).toFixed(3)} ms
      Buffer Time: ${(tBuffer).toFixed(3)} ms
      Total: ${(tTotal).toFixed(3)} ms
    `);

    // console.log('Frag stats', frag.stats);

    const levelAnalyzer = this.levelAnalyzers[frag.level];
    levelAnalyzer.updateFragmentMeasures(tLoad, tParse, stats.parsing.cumulative, tBuffer, tTotal, stats);
  }

  private measure (eventFrom: string, eventTo: string) {
    performance.measure(`${eventFrom} -> ${eventTo}`, eventFrom, eventTo);
  }
}

interface HlsListener {
  name: string
  fn: (e: string, data: any) => void
}

interface Measurement {
  name: string,
  eventFrom: string
  eventTo: string
}

const mediaElement = document.querySelector('video');
const hlsInstance = new Hls({
  progressive: false,
  debug: true,
  enableWorker: true
});
const analyzer = new PerformanceAnalyzer(hlsInstance, mediaElement);
analyzer.setup();
