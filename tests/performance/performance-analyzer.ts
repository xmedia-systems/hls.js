import { LoaderStats } from '../../src/types/loader';
import Fragment from '../../src/loader/fragment';
import LevelMeasurement from './LevelMeasurement';
import { Level } from '../../src/types/level';
import level from '../../../media-lighthouse/src/hls/level';
import {ChunkMetadata} from "../../src/types/transmuxer";

const Hls = window.Hls;
const Events = Hls.Events;

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

class PerformanceAnalyzer {
  private hls: any;
  private mediaElement: HTMLMediaElement;
  private listeners: HlsListener[] = [];
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
      { name: Events.BUFFER_APPENDED, fn: this.onBufferAppended.bind(this) },
      { name: Events.MANIFEST_PARSED, fn: this.onManifestParsed.bind(this) },
      { name: Events.FRAG_BUFFERED, fn: this.onFragBuffered.bind(this) }
    ];

    const simpleListeners = [];
    //   measuredEvents.map(event => ({
    //   name: event,
    //   fn: () => {
    //     performance.mark(event);
    //   }
    // }));

    return [...simpleListeners, ...advancedListeners];
  }

  private onManifestParsed (e, data: { levels: Level[] }) {
    const { mediaElement } = this;

    data.levels.forEach((level, i) => {
      this.levelAnalyzers.push(new LevelMeasurement(level, i));
    });

    mediaElement.play();
  }

  private onFragBuffered (e: string, data: { frag: Fragment, stats: LoaderStats }) {
    const { frag, stats } = data;
    const levelAnalyzer = this.levelAnalyzers[frag.level];
    levelAnalyzer.updateFragmentMeasures(stats);
  }

  private onBufferAppended (e: string, data: { type: string, chunkMeta: ChunkMetadata }) {
    const { chunkMeta, type } = data;
    const levelAnalyzer = this.levelAnalyzers[chunkMeta.level];
    levelAnalyzer.updateChunkMeasures(chunkMeta, type);
  }
}

interface HlsListener {
  name: string
  fn: (e: string, data: any) => void
}

const mediaElement = document.querySelector('video');
const hlsInstance = new Hls({
  progressive: false,
  debug: true,
  enableWorker: true,
  capLevelToPlayerSize: false
});
const analyzer = new PerformanceAnalyzer(hlsInstance, mediaElement);
analyzer.setup();
