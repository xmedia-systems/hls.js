import { Level } from '../../src/types/level';
import { LoaderStats } from '../../src/types/loader';
import CMA from './cumulative-moving-average';
import {ChunkMetadata} from "../../src/types/transmuxer";

export default class LevelMeasurement {
  private level: Level;
  private index: number;
  private fragLoadCMA: CMA = new CMA();
  private fragParseCMA: CMA = new CMA();
  private fragBufferCMA: CMA = new CMA();
  private fragTotalCMA: CMA = new CMA();
  private firstBufferCMA: CMA = new CMA();

  private chunkTransmuxCMA = new CMA();
  private chunkTransmuxIdleCMA = new CMA();
  private chunkVideoBufferCMA = new CMA();
  private chunkVideoBufferIdleCMA = new CMA();
  private chunkAudioBufferCMA = new CMA();
  private chunkAudioBufferIdleCMA = new CMA();

  private chunkSizeCMA = new CMA();

  constructor(level: Level, index: number) {
    this.level = level;
    this.index = index;
  }

  updateChunkMeasures (meta: ChunkMetadata, type: string) {
    const transmuxing = meta.transmuxing;
    const buffering = meta.buffering;

    this.chunkTransmuxCMA.update(transmuxing.end - transmuxing.start);
    const transmuxIdle = (transmuxing.end - transmuxing.start) - (transmuxing.executeEnd - transmuxing.executeStart);
    this.chunkTransmuxIdleCMA.update(transmuxIdle);
    if (type === 'video') {
      this.chunkVideoBufferCMA.update(buffering.video.end - buffering.video.start);
      this.chunkVideoBufferIdleCMA.update(buffering.video.executeStart - buffering.video.start);
    } else if (type === 'audio') {
      this.chunkAudioBufferCMA.update(buffering.audio.end - buffering.audio.start);
      this.chunkAudioBufferIdleCMA.update(buffering.audio.executeStart - buffering.audio.start);
    }

    if (meta.size) {
      this.chunkSizeCMA.update(meta.size);
    }

    // const statsString = (`Chunk stats:
    //   Average transmuxing time:        ${this.chunkTransmuxCMA.avg.toFixed(3)} ms
    //   Average transmux queue wait:     ${this.chunkTransmuxIdleCMA.avg.toFixed(3)} ms
    //
    //   Average video buffering time:    ${this.chunkVideoBufferCMA.avg.toFixed(3)} ms
    //   Average video buffer queue wait: ${this.chunkVideoBufferIdleCMA.avg.toFixed(3)} ms
    //
    // `);
    const statsString = (`
     ${this.chunkTransmuxCMA.avg.toFixed(3)}
     ${this.chunkTransmuxIdleCMA.avg.toFixed(3)}
     ${this.chunkVideoBufferCMA.avg.toFixed(3)}
     ${this.chunkVideoBufferIdleCMA.avg.toFixed(3)}
     ${this.chunkSizeCMA.avg.toFixed(3)}`);
    document.querySelector('.stats-container .chunk').innerText = statsString;
  }

  updateFragmentMeasures (stats: LoaderStats) {
    const loading = stats.loading;
    const parsing = stats.parsing;
    const buffering = stats.buffering;

    this.fragLoadCMA.update(loading.end - loading.start);
    this.fragParseCMA.update(parsing.end - parsing.start);
    this.fragBufferCMA.update(buffering.end - buffering.start);
    this.fragTotalCMA.update(buffering.end - loading.start);
    this.firstBufferCMA.update(buffering.first - loading.start);

    // const statsString = (`Level ${this.index} Stats:
    //   Average frag load time:             ${(this.fragLoadCMA.avg).toFixed(3)} ms
    //   Average frag parse time:            ${(this.fragParseCMA.avg).toFixed(3)} ms
    //   Average frag buffer time:           ${(this.fragBufferCMA.avg).toFixed(3)} ms
    //   Average total frag processing time: ${(this.fragTotalCMA.avg).toFixed(3)} ms
    // `);

    const statsString = (`
    ${(this.fragLoadCMA.avg).toFixed(3)}
    ${(this.fragParseCMA.avg).toFixed(3)}
    ${(this.fragBufferCMA.avg).toFixed(3)}
    ${(this.fragTotalCMA.avg).toFixed(3)}
    ${this.firstBufferCMA.avg.toFixed(3)}
    `);
    document.querySelector('.stats-container .frag').innerText = statsString;
  }
}
