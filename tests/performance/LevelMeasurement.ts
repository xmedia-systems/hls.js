import { Level } from '../../src/types/level';
import Fragment from '../../src/loader/fragment';
import { LoaderStats } from '../../src/types/loader';
import CMA from './cumulative-moving-average';

export default class LevelMeasurement {
  private level: Level;
  private index: number;
  private fragLoadCMA: CMA = new CMA();
  private fragParseCMA: CMA = new CMA();
  private fragBufferCMA: CMA = new CMA();
  private fragTotalCMA: CMA = new CMA();
  private transmuxCMA: CMA = new CMA();

  constructor(level: Level, index: number) {
    this.level = level;
    this.index = index;
  }

  updateFragmentMeasures (loadTime: number, parseTime: number, transmuxTime: number, bufferTime: number, totalTime: number, stats: LoaderStats) {
    this.fragLoadCMA.update(loadTime);
    this.fragParseCMA.update(parseTime);
    this.transmuxCMA.update(transmuxTime);
    this.fragBufferCMA.update(bufferTime);
    this.fragTotalCMA.update(totalTime);

    console.log(`Level ${this.index} Stats:
      Average frag load time: ${(this.fragLoadCMA.avg).toFixed(3)} ms
      Average frag parse time: ${(this.fragParseCMA.avg).toFixed(3)} ms
      Average frag cumulative transmux time: ${(this.transmuxCMA.avg).toFixed(3)} ms
      Average frag buffer time: ${(this.fragBufferCMA.avg).toFixed(3)} ms
      Average total frag processing time: ${(this.fragTotalCMA.avg).toFixed(3)} ms
    `);
  }
}