import { LoaderStats } from '../../src/types/loader';
import Fragment from '../../src/loader/fragment';
import LevelMeasurement from './LevelMeasurement';
import { Level } from '../../src/types/level';
import level from '../../../media-lighthouse/src/hls/level';
import {ChunkMetadata} from "../../src/types/transmuxer";

const Hls = window.Hls;
const Events = Hls.Events;

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

  setup (src) {
    const { hls, listeners, mediaElement } = this;

    listeners.forEach(l => {
      hls.on(l.name, l.fn);
    });

    hls.loadSource(src);
    hls.attachMedia(mediaElement);
  }

  destroy () {
    const { hls, listeners } = this;
    listeners.forEach(l => {
      hls.off(l.name, l.fn);
    });
  }

  private createListeners (): HlsListener[] {
    return [
      { name: Events.BUFFER_APPENDED, fn: this.onBufferAppended.bind(this) },
      { name: Events.MANIFEST_PARSED, fn: this.onManifestParsed.bind(this) },
      { name: Events.FRAG_BUFFERED, fn: this.onFragBuffered.bind(this) }
    ];
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

  private onBufferAppended (e: string, data: { type: string, chunkMeta: ChunkMetadata, fragStats: LoaderStats }) {
    const { chunkMeta, type, fragStats } = data;
    const levelAnalyzer = this.levelAnalyzers[chunkMeta.level];
    levelAnalyzer.updateChunkMeasures(chunkMeta, type, fragStats);
  }
}

interface HlsListener {
  name: string
  fn: (e: string, data: any) => void
}

const mediaElement = document.querySelector('video');
const hlsInstance = new Hls({
  // progressive: false,
  // debug: true,
  enableWorker: true,
  capLevelToPlayerSize: false,
  maxBufferLength: 60
});
const analyzer = new PerformanceAnalyzer(hlsInstance, mediaElement);
analyzer.setup('http://localhost:9999/25mb/file.m3u8');
