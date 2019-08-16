import { HlsNetworkTiming, HlsPerformanceTiming, HlsProgressivePerformanceTiming, LoaderStats } from '../types/loader';

export default class LoadStats implements LoaderStats {
  aborted: boolean = false;
  loaded: number = 0;
  retry: number = 0;
  total: number = 0;
  chunkCount: number = 0;
  bwEstimate: number = 0;
  loading: HlsNetworkTiming = { start: 0, firstByte: 0, end: 0 };
  parsing: HlsProgressivePerformanceTiming = { start: 0, end: 0, idling: 0, executing: 0 };
  buffering: HlsProgressivePerformanceTiming = { start: 0, end: 0, idling: 0, executing: 0 };
}

