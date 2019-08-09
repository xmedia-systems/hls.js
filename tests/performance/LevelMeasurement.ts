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

  constructor(level: Level, index: number) {
    this.level = level;
    this.index = index;
  }

  updateFragmentMeasures (stats: LoaderStats) {
    this.fragLoadCMA.update(stats.tload - stats.trequest);
    this.fragParseCMA.update(stats.parseCumulative);
    this.fragBufferCMA.update(stats.tbuffered - stats.tparsed);
    this.fragTotalCMA.update(stats.tbuffered - stats.trequest);

    console.log(`Level ${this.index} Stats:
      Average frag load time: ${this.fragLoadCMA.avg}
      Average frag parse time: ${this.fragParseCMA.avg}
      Average frag buffer time: ${this.fragBufferCMA.avg}
      Average total frag processing time: ${this.fragTotalCMA.avg}
    `);
  }
}